import "reflect-metadata";
import { SQL } from "bun";
import { container } from "tsyringe";
import { Migrator } from "../database/migrator";
import { Application } from "./app";
import { AppConfig } from "./config/app.config";
import { registerDependencies } from "./container";

registerDependencies();
const config = container.resolve(AppConfig);

// On production, migrate first. If a migration fails, this throws and the server does not start.
if (config.isProduction) {
  const ran = await new Migrator(container.resolve(SQL)).run();
  console.log(ran.length > 0 ? `Migrated: ${ran.join(", ")}` : "Nothing to migrate.");
}

const app = container.resolve(Application).build();
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Listening on ${server.url}`);
