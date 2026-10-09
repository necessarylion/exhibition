export type Env = Record<string, string | undefined>;

export class AppConfig {
  readonly isProduction: boolean;
  readonly port: number;
  readonly appName: string;
  readonly databaseUrl: string;
  readonly tokenTtlDays: number;
  readonly inertiaSsr: boolean;
  readonly viteDevServerUrl: string;
  /** The folder for uploaded files. It must survive a restart. */
  readonly storageDir: string;
  /**
   * How many proxies of our own are in front of the app. 0: `X-Forwarded-For` is ignored
   * and the address of the connection is the client.
   */
  readonly trustedProxies: number;
  /** Serve the API docs page at `/docs`. */
  readonly apiDocs: boolean;
  /** Print one line per request. */
  readonly logRequests: boolean;
  /**
   * In 15 minutes: wrong logins of one client address for one email, sign-ups per client
   * address, and wrong "current password" tries per user.
   */
  readonly rateLimitMax: number;
  /** In 15 minutes: wrong logins per client address, and "add a user" calls per user. */
  readonly rateLimitIpMax: number;
  /** In 15 minutes: wrong logins for one email from every address together. */
  readonly rateLimitEmailMax: number;

  constructor(env: Env) {
    this.isProduction = env.NODE_ENV === "production";
    this.port = this.readNumber(env, "PORT", 3000);
    if (!Number.isInteger(this.port) || this.port > 65535) {
      throw new Error("PORT must be a whole number from 1 to 65535.");
    }
    this.appName = env.APP_NAME ?? "Exhibition";
    this.databaseUrl = this.readDatabaseUrl(env);
    this.tokenTtlDays = this.readNumber(env, "TOKEN_TTL_DAYS", 30);
    this.inertiaSsr = env.INERTIA_SSR === "true";
    this.viteDevServerUrl = env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    this.storageDir = env.STORAGE_DIR ?? "./storage";
    if (env.TRUST_PROXY === "true") {
      throw new Error(
        "TRUST_PROXY is gone. Set TRUSTED_PROXIES to the number of your own proxies (see the README).",
      );
    }
    this.trustedProxies = Number(env.TRUSTED_PROXIES || 0);
    if (!Number.isInteger(this.trustedProxies) || this.trustedProxies < 0) {
      throw new Error(
        `TRUSTED_PROXIES must be a whole number, 0 or more. It is "${env.TRUSTED_PROXIES}".`,
      );
    }
    this.apiDocs = env.API_DOCS ? env.API_DOCS === "true" : !this.isProduction;
    this.logRequests = env.LOG_REQUESTS ? env.LOG_REQUESTS === "true" : env.NODE_ENV !== "test";
    this.rateLimitMax = this.readNumber(env, "RATE_LIMIT_MAX", 10);
    this.rateLimitIpMax = this.readNumber(env, "RATE_LIMIT_IP_MAX", 50);
    this.rateLimitEmailMax = this.readNumber(env, "RATE_LIMIT_EMAIL_MAX", 100);
  }

  /** A number above 0. A wrong value stops the start with a clear message. */
  private readNumber(env: Env, name: string, fallback: number): number {
    const value = Number(env[name] || fallback);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a number above 0. It is "${env[name]}".`);
    }
    return value;
  }

  private readDatabaseUrl(env: Env): string {
    const url = env.DATABASE_URL;
    if (!url) {
      if (this.isProduction) {
        throw new Error("DATABASE_URL is required in production.");
      }
      return "sqlite://database/dev.sqlite";
    }
    if (!/^(sqlite|postgres|postgresql):/.test(url)) {
      // The value is not printed. It can hold a password.
      throw new Error("DATABASE_URL must start with sqlite:, postgres: or postgresql:.");
    }
    return url;
  }
}
