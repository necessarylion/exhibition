import { SQL } from "bun";
import { container } from "tsyringe";
import { openDatabase } from "../database/open-database";
import { AppConfig } from "./config/app.config";

/**
 * Only the values tsyringe cannot build by itself are registered here.
 * Every other class has `@singleton()` and is built from its constructor types.
 */
export async function registerDependencies(): Promise<void> {
  const config = new AppConfig(Bun.env);
  container.registerInstance(AppConfig, config);
  container.registerInstance(SQL, await openDatabase(config.databaseUrl));
}
