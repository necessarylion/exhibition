export type Env = Record<string, string | undefined>;

export class AppConfig {
  readonly isProduction: boolean;
  readonly port: number;
  readonly appName: string;
  readonly databaseUrl: string;
  readonly tokenTtlDays: number;
  readonly inertiaSsr: boolean;
  readonly viteDevServerUrl: string;

  constructor(env: Env) {
    this.isProduction = env.NODE_ENV === "production";
    this.port = Number(env.PORT ?? 3000);
    this.appName = env.APP_NAME ?? "Exhibition";
    this.databaseUrl = this.readDatabaseUrl(env);
    this.tokenTtlDays = Number(env.TOKEN_TTL_DAYS ?? 30);
    this.inertiaSsr = env.INERTIA_SSR === "true";
    this.viteDevServerUrl = env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
  }

  private readDatabaseUrl(env: Env): string {
    if (env.DATABASE_URL) {
      return env.DATABASE_URL;
    }
    if (this.isProduction) {
      throw new Error("DATABASE_URL is required in production.");
    }
    return "sqlite://database/dev.sqlite";
  }
}
