import "reflect-metadata";
import { SQL } from "bun";
import { container } from "tsyringe";
import { Migrator } from "../database/migrator";
import { Application } from "./app";
import { AppConfig } from "./config/app.config";
import { MAX_PHOTO_REQUEST_BYTES } from "./constants/upload.constants";
import { registerDependencies } from "./container";
import { TokenCleaner } from "./services/token-cleaner.service";

await registerDependencies();
const config = container.resolve(AppConfig);
const sql = container.resolve(SQL);

// On production, migrate first. If a migration fails, this throws and the server does not start.
if (config.isProduction) {
  const ran = await new Migrator(sql).run();
  console.log(ran.length > 0 ? `Migrated: ${ran.join(", ")}` : "Nothing to migrate.");
}

const app = container.resolve(Application).build();
// Bun refuses a bigger body before the app reads it. The photo upload is the biggest one.
const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  maxRequestBodySize: MAX_PHOTO_REQUEST_BYTES,
});
console.log(`Listening on ${server.url}`);

const tokenCleaner = container.resolve(TokenCleaner);
tokenCleaner.start();

/** Stops in order: no new requests, the running ones finish, then the database closes. */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down.`);
  tokenCleaner.stop();
  await server.stop();
  await sql.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
