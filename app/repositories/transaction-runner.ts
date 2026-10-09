import { AsyncLocalStorage } from "node:async_hooks";
import { SQL, type TransactionSQL } from "bun";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";

/** The work that runs inside a transaction. It uses `db` for every query. */
export type TransactionWork<T> = (db: TransactionSQL) => Promise<T>;

/**
 * Runs a transaction. Every transaction of the app starts here.
 * PostgreSQL runs transactions side by side. SQLite has one connection: a query of another
 * request would run inside the transaction that is open at that moment, and would be lost
 * when that transaction rolls back. So on SQLite the work runs one after the other: each
 * API request as a whole (`alone` is a middleware there), and each transaction.
 */
// ponytail: SQLite is for development and tests, so one request at a time is fine there.
// Production uses PostgreSQL, where nothing waits here.
@singleton()
export class TransactionRunner {
  private last: Promise<void> = Promise.resolve();
  /** Set while this chain of calls has its turn. Work inside a turn does not wait again. */
  private readonly turn = new AsyncLocalStorage<true>();
  /** How long one API request may hold its turn. A test makes it short. */
  requestTimeoutMs = 30_000;

  constructor(private readonly sql: SQL) {}

  /** True on SQLite: the work runs one after the other. */
  get serial(): boolean {
    return this.sql.options.adapter === "sqlite";
  }

  run<T>(work: TransactionWork<T>): Promise<T> {
    return this.alone(this.begin.bind(this, work)) as Promise<T>;
  }

  /** On SQLite: waits until the work before it is over, then runs. On PostgreSQL: just runs. */
  async alone<T>(work: () => Promise<T>): Promise<T> {
    if (!this.serial || this.turn.getStore()) {
      return work();
    }
    const before = this.last;
    const mine = Promise.withResolvers<void>();
    this.last = mine.promise;
    await before;
    try {
      return await this.turn.run(true, work);
    } finally {
      mine.resolve();
    }
  }

  /**
   * One API request on SQLite. Like `alone`, but a request that is stuck gives its turn
   * back after `requestTimeoutMs` and fails with a 503, so the other requests go on.
   */
  // ponytail: the stuck work is not stopped, it only loses its turn. If it wakes up later
  // it runs next to another request. Fine for development; production is PostgreSQL.
  aloneWithTimeout(work: () => Promise<void>): Promise<void> {
    return this.alone(this.withTimeout.bind(this, work));
  }

  /** The time starts when the request gets its turn, not while it waits for it. */
  private async withTimeout(work: () => Promise<void>): Promise<void> {
    const tooSlow = Promise.withResolvers<never>();
    const timer = setTimeout(
      tooSlow.reject,
      this.requestTimeoutMs,
      new AppError(503, ErrorCode.Busy, "The request took too long. Try again."),
    );
    try {
      await Promise.race([work(), tooSlow.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private begin<T>(work: TransactionWork<T>): Promise<T> {
    return this.sql.begin(work) as Promise<T>;
  }
}
