import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { RATE_LIMIT_MAX_KEYS, RATE_LIMIT_WINDOW_MS } from "../constants/rate-limit.constants";
import { AppError } from "../errors/app.error";
import { Clock } from "./clock.service";

interface Window {
  count: number;
  endsAt: number;
}

/** One count of an attempt: the key, and how many attempts the key may have in its window. */
export type Limit = [key: string, max: number];

/** Counts attempts per key in a time window. The caller says how many a key may have. */
// ponytail: in-memory, per process. Every server has its own counts and a restart clears
// them. Use a shared store (Redis or a table) when the app runs on more than one server.
@singleton()
export class RateLimiter {
  /** A `Map` keeps the order the keys were added in. The first key is the oldest one. */
  private readonly windows = new Map<string, Window>();

  constructor(private readonly clock: Clock) {}

  /**
   * Takes one attempt on every key, or throws 429 and takes none when one key is full.
   * Call it BEFORE the work, and `release` after work that should not count. So requests
   * that run at the same moment can never pass the limit together.
   */
  reserve(limits: readonly Limit[]): void {
    const now = this.clock.now();
    for (const [key, max] of limits) {
      const window = this.live(key, now);
      if (window && window.count >= max) {
        const seconds = Math.ceil((window.endsAt - now) / 1000);
        throw new AppError(
          429,
          ErrorCode.TooManyRequests,
          `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`,
          { "Retry-After": String(seconds) },
        );
      }
    }
    for (const [key] of limits) {
      let window = this.live(key, now);
      if (!window) {
        this.makeRoom(now);
        window = { count: 0, endsAt: now + RATE_LIMIT_WINDOW_MS };
        this.windows.set(key, window);
      }
      window.count++;
    }
  }

  /** Gives one attempt back on every key. A key with no attempt left is forgotten. */
  release(limits: readonly Limit[]): void {
    for (const [key] of limits) {
      const window = this.windows.get(key);
      if (window && --window.count <= 0) {
        this.windows.delete(key);
      }
    }
  }

  /** For attempts that always count. */
  hit(key: string, max: number): void {
    this.reserve([[key, max]]);
  }

  /** How many keys are known now. A test reads it. */
  get size(): number {
    return this.windows.size;
  }

  /** The window of the key when it is not over yet. */
  private live(key: string, now: number): Window | undefined {
    const window = this.windows.get(key);
    if (window && window.endsAt <= now) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  /**
   * A full limiter never refuses a new key: that would close the login for everybody.
   * It drops the windows that are over, and then the oldest keys.
   */
  // ponytail: somebody who makes this many keys in one window can push an old count out.
  // The limit is high, so that needs a very big flood. Use a shared store if it happens.
  private makeRoom(now: number): void {
    if (this.windows.size < RATE_LIMIT_MAX_KEYS) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.endsAt <= now) {
        this.windows.delete(key);
      }
    }
    for (const key of this.windows.keys()) {
      if (this.windows.size < RATE_LIMIT_MAX_KEYS) {
        return;
      }
      this.windows.delete(key);
    }
  }
}
