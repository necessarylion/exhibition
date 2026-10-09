import "reflect-metadata";
import { SQL } from "bun";
import { container } from "tsyringe";
import { AppConfig } from "../app/config/app.config";
import { DAY_MS } from "../app/constants/time.constants";
import { registerDependencies } from "../app/container";
import { UserRepository } from "../app/repositories/user.repository";
import { newPassword } from "../app/schemas/fields";
import { AuthService } from "../app/services/auth.service";
import { Clock } from "../app/services/clock.service";
import { CompanyService } from "../app/services/company.service";
import { ItemService } from "../app/services/item.service";
import { NotificationService } from "../app/services/notification.service";
import { OrderService } from "../app/services/order.service";
import { OrganizationService } from "../app/services/organization.service";
import { PhotoStorageService } from "../app/services/photo-storage.service";
import { ProjectService } from "../app/services/project.service";
import { UserService } from "../app/services/user.service";
import { Migrator } from "./migrator";
import {
  DEFAULT_SEED_PASSWORD,
  DELETE_DATA_FLAG,
  describeDatabase,
  Seeder,
  seedRefusal,
} from "./seeder";

// Usage: bun run seed            fills an empty database with test data
//        bun run seed --fresh    empties the app tables first, then fills them
// On a database that is not SQLite, `--fresh` also needs `--i-know-this-deletes-data`.
// Every seeded user has the same password: SEED_PASSWORD, or the default of the README.

/** The clock of the app, moved by some days. The seeder makes old projects with it. */
class SeedClock extends Clock {
  offsetMs = 0;

  override now(): number {
    return Date.now() + this.offsetMs;
  }

  setDaysFromNow(days: number): void {
    this.offsetMs = days * DAY_MS;
  }
}

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

const fresh = Bun.argv.includes("--fresh");
const request = {
  nodeEnv: Bun.env.NODE_ENV,
  // Not known before the database is open. `false` is the careful guess.
  sqlite: false,
  fresh,
  confirmed: Bun.argv.includes(DELETE_DATA_FLAG),
  companies: 0,
};
// The first check runs before the database is opened.
if (request.nodeEnv === "production") {
  stop(seedRefusal(request) ?? "");
}
const password = newPassword("SEED_PASSWORD").safeParse(
  Bun.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD,
);
if (!password.success) {
  stop(password.error.issues[0]?.message ?? "SEED_PASSWORD is not valid.");
}

const started = performance.now();
await registerDependencies();
const clock = new SeedClock();
container.registerInstance(Clock, clock);
const sql = container.resolve(SQL);
request.sqlite = sql.options.adapter === "sqlite";
try {
  const [row] = await sql`SELECT COUNT(*) AS total FROM companies`;
  request.companies = Number(row.total);
} catch {
  // A new database has no tables yet. It has no companies.
}
// Checked before anything is written, also before the migrations.
const refusal = seedRefusal(request);
if (refusal) {
  await sql.close();
  stop(refusal);
}
const ran = await new Migrator(sql).run();
if (ran.length > 0) {
  console.log(`Migrated: ${ran.join(", ")}`);
}

const seeder = new Seeder(
  {
    sql,
    users: container.resolve(UserRepository),
    authService: container.resolve(AuthService),
    companyService: container.resolve(CompanyService),
    userService: container.resolve(UserService),
    itemService: container.resolve(ItemService),
    organizationService: container.resolve(OrganizationService),
    projectService: container.resolve(ProjectService),
    orderService: container.resolve(OrderService),
    notificationService: container.resolve(NotificationService),
    photos: container.resolve(PhotoStorageService),
    setDaysFromNow: clock.setDaysFromNow.bind(clock),
  },
  password.data,
);

if (fresh) {
  const database = describeDatabase(container.resolve(AppConfig).databaseUrl);
  console.log(
    `Deleting ALL data of the database "${database.name}" on ${database.host}: ${request.companies} companies and everything they have.`,
  );
  await seeder.empty();
}

const accounts = await seeder.run();
await sql.close();

console.table(accounts);
console.log(`Password of every account: ${password.data}`);
console.log(`Done in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
