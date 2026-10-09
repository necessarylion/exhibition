import { SQL } from "bun";
import { container } from "tsyringe";
import { AppConfig } from "./config/app.config";

/**
 * Only the values tsyringe cannot build by itself are registered here.
 * Every other class has `@singleton()` and is built from its constructor types.
 */
export function registerDependencies(): void {
  const config = new AppConfig(Bun.env);
  container.registerInstance(AppConfig, config);
  container.registerInstance(SQL, new SQL(config.databaseUrl));
}
