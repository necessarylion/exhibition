import "reflect-metadata";
import { SQL } from "bun";
import { container } from "tsyringe";
import { registerDependencies } from "../app/container";
import { Migrator } from "./migrator";

registerDependencies();
const sql = container.resolve(SQL);
const ran = await new Migrator(sql).run();
console.log(ran.length > 0 ? `Migrated: ${ran.join(", ")}` : "Nothing to migrate.");
await sql.close();
