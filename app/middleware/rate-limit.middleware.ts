import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";
import { singleton } from "tsyringe";
import { AppConfig } from "../config/app.config";
import { ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";
import { type Limit, RateLimiter } from "../services/rate-limiter.service";
import type { AppEnv } from "./bearer-auth.middleware";

/** Slows down password guessing and mass sign-ups. Put it before the handler of a route. */
@singleton()
export class RateLimitMiddleware {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly config: AppConfig,
  ) {}

  /**
   * For the login. Only a wrong email or password counts. Three counts:
   * - per client address and email: the hard stop for one guesser.
   * - per client address: it stops one client that tries many emails.
   * - per email from every address: a high brake. It is high on purpose, so one person
   *   cannot easily lock another person out of their account.
   * The attempt is taken before the password check and given back after a login that was
   * no wrong guess. So requests at the same moment cannot pass the limit together.
   */
  async login(c: Context, next: Next): Promise<void> {
    const address = this.clientIp(c);
    const email = await this.readEmail(c);
    const limits: Limit[] = [
      [`login ${address} ${email}`, this.config.rateLimitMax],
      [`login-address ${address}`, this.config.rateLimitIpMax],
      [`login-email ${email}`, this.config.rateLimitEmailMax],
    ];
    await this.countWhen(c, next, limits, this.isWrongLogin);
  }

  /** For the sign-up: every attempt of one client address counts. */
  async register(c: Context, next: Next): Promise<void> {
    this.limiter.hit(`register ${this.clientIp(c)}`, this.config.rateLimitMax);
    await next();
  }

  /** For "change my password": a wrong current password counts, per user. Put it after the bearer check. */
  async changePassword(c: Context<AppEnv>, next: Next): Promise<void> {
    const limits: Limit[] = [[`password ${c.get("user").id}`, this.config.rateLimitMax]];
    await this.countWhen(c, next, limits, this.isWrongPassword);
  }

  /**
   * For "add a user": every attempt of a user who may add users counts. The answer tells
   * if an email has an account, so it must not be asked without end. A call that is refused
   * before that (403, 404) tells nothing and leaves no key. Put it after the bearer check.
   */
  async addUser(c: Context<AppEnv>, next: Next): Promise<void> {
    const limits: Limit[] = [[`add-user ${c.get("user").id}`, this.config.rateLimitIpMax]];
    await this.countWhen(c, next, limits, this.wasAllowed);
  }

  /** Takes the attempt, runs the handler, and gives the attempt back when it does not count. */
  private async countWhen(
    c: Context,
    next: Next,
    limits: Limit[],
    counts: (c: Context) => boolean,
  ): Promise<void> {
    this.limiter.reserve(limits);
    let counted = false;
    try {
      await next();
      counted = counts.call(this, c);
    } finally {
      if (!counted) {
        this.limiter.release(limits);
      }
    }
  }

  private isWrongLogin(c: Context): boolean {
    return this.failedWith(c, ErrorCode.InvalidCredentials);
  }

  private isWrongPassword(c: Context): boolean {
    return this.failedWith(c, ErrorCode.WrongPassword);
  }

  private wasAllowed(c: Context): boolean {
    return !(c.error instanceof AppError && (c.error.status === 403 || c.error.status === 404));
  }

  /** True when the handler threw an error with this code. */
  private failedWith(c: Context, code: string): boolean {
    return c.error instanceof AppError && c.error.code === code;
  }

  /**
   * The address of the client. Anyone can send `X-Forwarded-For`, so only the part that
   * our own proxies wrote is used. Each proxy adds the address it got the request from
   * at the END. With N trusted proxies the client is the N-th value from the right.
   */
  private clientIp(c: Context): string {
    const hops = this.config.trustedProxies;
    if (hops > 0) {
      const values = (c.req.header("X-Forwarded-For") ?? "").split(",");
      const address = values[values.length - hops]?.trim();
      if (address) {
        return network(address);
      }
    }
    try {
      return network(getConnInfo(c).remote.address ?? "unknown");
    } catch {
      // There is no connection, for example in a test.
      return "unknown";
    }
  }

  /** The email as the login will see it. Hono keeps the parsed body for the handler. */
  private async readEmail(c: Context): Promise<string> {
    try {
      const { email } = await c.req.json();
      return typeof email === "string" ? email.trim().toLowerCase().slice(0, 255) : "";
    } catch {
      return "";
    }
  }
}

/**
 * What one client is. An IPv4 address is one client. An IPv6 client usually has a whole
 * /64 network of addresses, so the first 4 groups of an IPv6 address are the client.
 */
export function network(raw: string): string {
  // Some proxies add the port: "203.0.113.9:51000" or "[2001:db8::9]:443". The port is not
  // part of the client.
  const address = raw
    .replace(/^\[(.+)\](:\d+)?$/, "$1")
    .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) {
    return mapped[1] as string;
  }
  if (!address.includes(":")) {
    return address;
  }
  // "::" stands for as many groups of 0 as are missing to make 8 groups.
  const [head = "", tail] = address.toLowerCase().split("::");
  const groups = head === "" ? [] : head.split(":");
  if (tail !== undefined) {
    const last = tail === "" ? [] : tail.split(":");
    while (groups.length + last.length < 8) {
      groups.push("0");
    }
    groups.push(...last);
  }
  const first = [];
  for (const group of groups.slice(0, 4)) {
    first.push(group.replace(/^0+(?=.)/, ""));
  }
  return `${first.join(":")}::/64`;
}
