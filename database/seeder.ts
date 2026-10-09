import { deflateSync } from "node:zlib";
import type { SQL } from "bun";
import type { ItemUnit } from "../app/constants/item.constants";
import { DAY_MS } from "../app/constants/time.constants";
import type { Company } from "../app/models/company.model";
import type { Item } from "../app/models/item.model";
import type { Order } from "../app/models/order.model";
import type { User } from "../app/models/user.model";
import type { UserRepository } from "../app/repositories/user.repository";
import type { RegisterInput } from "../app/schemas/auth.schema";
import type { AuthService } from "../app/services/auth.service";
import type { CompanyService } from "../app/services/company.service";
import type { ItemService } from "../app/services/item.service";
import type { NotificationService } from "../app/services/notification.service";
import type { OrderService } from "../app/services/order.service";
import type { OrganizationService } from "../app/services/organization.service";
import type { PhotoStorageService } from "../app/services/photo-storage.service";
import type { ProjectService } from "../app/services/project.service";
import type { UserService } from "../app/services/user.service";

/** The password of every seeded user when `SEED_PASSWORD` is not set. */
export const DEFAULT_SEED_PASSWORD = "exhibition-demo-1";

/** `--fresh` on a database that is not SQLite needs this flag too. */
export const DELETE_DATA_FLAG = "--i-know-this-deletes-data";

/** What `bun run seed` was asked to do, and on what. */
export interface SeedRequest {
  nodeEnv: string | undefined;
  /** False for PostgreSQL. A SQLite file is a development database. */
  sqlite: boolean;
  /** `--fresh` was passed. */
  fresh: boolean;
  /** `DELETE_DATA_FLAG` was passed. */
  confirmed: boolean;
  /** How many companies the database has now. */
  companies: number;
}

/**
 * Why the seeder must not run, or `null` when it may. The seeder makes users with a
 * password that everybody knows, and `--fresh` deletes every row. So it must be
 * impossible to run it on a real database by accident.
 */
export function seedRefusal(request: SeedRequest): string | null {
  if (request.nodeEnv === "production") {
    return "The seeder makes test data. It does not run with NODE_ENV=production.";
  }
  if (request.fresh && !request.sqlite && !request.confirmed) {
    return `This is not a SQLite database. \`--fresh\` deletes ALL its data. Nothing was changed.\nIf this is a test database, run \`bun run seed --fresh ${DELETE_DATA_FLAG}\`.`;
  }
  if (!request.fresh && request.companies > 0) {
    const flag = request.sqlite ? "" : ` ${DELETE_DATA_FLAG}`;
    return `The database already has companies. Nothing was changed.\nRun \`bun run seed --fresh${flag}\` to empty the app tables first. That deletes ALL data of this database.`;
  }
  return null;
}

/** Where the database is and what it is called, to print it. Never the user or the password. */
export function describeDatabase(url: string): { host: string; name: string } {
  if (url.startsWith("sqlite:") || url === ":memory:") {
    return { host: "this computer", name: url.replace(/^sqlite:(\/\/)?/, "") };
  }
  const parsed = new URL(url);
  return { host: parsed.host, name: decodeURIComponent(parsed.pathname.slice(1)) };
}

/** Everything the seeder calls. All data goes through the services, so every rule holds. */
export interface SeederParts {
  sql: SQL;
  users: UserRepository;
  authService: AuthService;
  companyService: CompanyService;
  userService: UserService;
  itemService: ItemService;
  organizationService: OrganizationService;
  projectService: ProjectService;
  orderService: OrderService;
  notificationService: NotificationService;
  photos: PhotoStorageService;
  /**
   * Moves the clock of the app: 0 is now, -30 is 30 days ago. The seeder makes old
   * projects and orders with it, so the lists and the charts have a past.
   */
  setDaysFromNow: (days: number) => void;
}

/** One line of the table that the seed script prints. */
export interface SeededAccount {
  email: string;
  role: string;
  company: string;
  /** What this account is good for in a test by hand. */
  tryIt: string;
}

/** `[name, category, price in cents, unit, stock or null for no limit]` */
type ItemSpec = [string, string, number, ItemUnit, number | null];

/** The tables of the app, in an order that never breaks a foreign key. */
const TABLES = [
  "notifications",
  "admin_actions",
  "access_tokens",
  "project_lines",
  "order_lines",
  "orders",
  "projects",
  "item_photos",
  "items",
  "users",
  "companies",
  "organizations",
];

/** The colour of the placeholder photo of each category: red, green, blue. */
const COLOURS: Record<string, [number, number, number]> = {
  Booth: [194, 65, 12],
  Furniture: [22, 101, 52],
  Lighting: [202, 138, 4],
  Screens: [29, 78, 216],
  Flooring: [87, 83, 78],
  Graphics: [162, 28, 175],
};

const DETAILS: Record<string, { material: string; color: string; size: [number, number, number] }> =
  {
    Booth: { material: "Aluminium and panels", color: "White", size: [300, 250, 300] },
    Furniture: { material: "Wood and steel", color: "Black", size: [60, 90, 60] },
    Lighting: { material: "Aluminium", color: "Silver", size: [30, 40, 30] },
    Screens: { material: "LED panel", color: "Black", size: [120, 70, 8] },
    Flooring: { material: "Carpet", color: "Grey", size: [100, 1, 100] },
    Graphics: { material: "Printed fabric", color: "Full colour", size: [200, 250, 2] },
  };

/**
 * Fills the database with a small trade-fair world for tests by hand: the platform admin,
 * suppliers, customers, a group, items with photos, and projects and orders in every status.
 */
export class Seeder {
  private readonly accounts: SeededAccount[] = [];
  private readonly items = new Map<string, Item>();
  private photoCount = 0;

  constructor(
    private readonly parts: SeederParts,
    private readonly password: string = DEFAULT_SEED_PASSWORD,
  ) {}

  /** True when the database already has a company. */
  async hasData(): Promise<boolean> {
    const [row] = await this.parts.sql`SELECT COUNT(*) AS total FROM companies`;
    return Number(row.total) > 0;
  }

  /** Deletes every row of the app tables and the photo files. The schema stays. */
  async empty(): Promise<void> {
    const { sql, photos } = this.parts;
    const files: { file: string }[] = await sql`SELECT file FROM item_photos`;
    for (const { file } of files) {
      await photos.remove(file);
    }
    for (const table of TABLES) {
      await sql.unsafe(`DELETE FROM ${table}`);
    }
  }

  async run(): Promise<SeededAccount[]> {
    const { parts } = this;
    // The companies are three months old. The clock of the app only moves forward, so the
    // oldest things are made first.
    this.at(-90);
    // ---- The platform admin, with a few items of its own.
    const admin = await parts.authService.registerAdmin(
      this.person("Mya Thandar", "admin@exhibition.test"),
    );
    this.note(
      admin,
      "admin",
      "Everything: customers, suppliers, groups, projects, act as a customer",
    );
    const ops = await parts.userService.create(
      admin,
      this.person("Ko Htet", "ops@exhibition.test"),
    );
    this.note(ops, "admin", "A second admin (not the owner)");
    await this.addItems(admin, [
      ["Raised platform floor", "Flooring", 1800, "sqm", null],
      ["Fascia name board", "Graphics", 4500, "piece", 60],
      ["Info counter with logo", "Furniture", 9500, "piece", 12],
    ]);

    // ---- Suppliers. Three are approved, one signed up by itself and waits.
    const golden = await this.company("supplier", "Golden Stand Builders", "Aung Kyaw", "golden");
    this.note(golden, "supplier", "Orders in every status, one with a line that is short of stock");
    const goldenSales = await parts.userService.create(
      golden,
      this.person("Su Su Hlaing", "sales@golden.test"),
    );
    this.note(goldenSales, "supplier", "A second user (not the owner): read-only Team page");
    await this.addItems(golden, [
      ["Shell scheme booth 3 × 3 m", "Booth", 85000, "piece", 4],
      ["Shell scheme booth 6 × 3 m", "Booth", 150000, "piece", 6],
      ["Island booth 6 × 6 m", "Booth", 420000, "piece", 2],
      ["Corner booth upgrade", "Booth", 35000, "piece", null],
      ["Grey carpet", "Flooring", 900, "sqm", null],
      ["Wood look vinyl floor", "Flooring", 2400, "sqm", 500],
      ["Printed back wall 3 m", "Graphics", 28000, "piece", 20],
      ["Roll-up banner", "Graphics", 6500, "piece", 40],
      ["Hanging banner 4 m", "Graphics", 52000, "piece", 8],
    ]);
    const lumen = await this.company("supplier", "Lumen Stage & Light", "Thiri Win", "lumen");
    this.note(
      lumen,
      "supplier",
      "Lighting and screens: an order to accept, a rejected one, a chart",
    );
    await this.addItems(lumen, [
      ["LED video wall 3 × 2 m", "Screens", 180000, "set", 2],
      ["55 inch screen on stand", "Screens", 22000, "piece", 15],
      ["Touch screen kiosk", "Screens", 48000, "piece", 6],
      ["LED spot light", "Lighting", 1800, "piece", 200],
      ["Truss lighting rig 6 m", "Lighting", 64000, "set", 4],
      ["Arm light for back wall", "Lighting", 1500, "piece", null],
      ["Moving head light", "Lighting", 9500, "piece", 24],
      ["Power cable 10 m", "Lighting", 600, "meter", null],
    ]);
    const nordic = await this.company("supplier", "Nordic Furniture Rental", "Erik Lund", "nordic");
    this.note(nordic, "supplier", "Furniture: a hidden item and an item that is over-booked");
    await this.addItems(nordic, [
      ["Bar stool", "Furniture", 1500, "piece", 40],
      ["Bistro table", "Furniture", 3200, "piece", 25],
      ["Reception counter", "Furniture", 12000, "piece", 10],
      ["Lounge sofa", "Furniture", 18000, "piece", 6],
      ["Folding chair", "Furniture", 600, "piece", 300],
      ["Brochure rack", "Furniture", 2500, "piece", 30],
      ["Lockable cabinet", "Furniture", 5400, "piece", 12],
      ["Glass showcase", "Furniture", 26000, "piece", 5],
    ]);
    await parts.itemService.update(nordic, this.item("Glass showcase").id, { hidden: true });

    const fresh = (
      await parts.authService.register(
        this.account("supplier", "Fresh Booth Co", "Nay Lin", "owner@fresh.test"),
      )
    ).user;
    this.note(fresh, "supplier", "Waiting for approval: the banner, items not in the catalog");
    await this.profile(fresh, "Fresh Booth Co");
    await this.addItems(fresh, [
      ["Pop-up booth 3 × 2 m", "Booth", 60000, "piece", 5],
      ["Bamboo counter", "Furniture", 8000, "piece", 8],
      ["Rope light 5 m", "Lighting", 900, "meter", null],
      ["Tablet stand", "Screens", 3000, "piece", 20],
      ["Jute carpet", "Flooring", 1300, "sqm", null],
      ["Fabric banner 2 m", "Graphics", 7000, "piece", 15],
    ]);

    // ---- Customers. True Money and True Sim are in one group and share their items.
    const trueMoney = await this.company("customer", "True Money", "Zin Mar", "truemoney");
    this.note(trueMoney, "customer", "Projects in every status, shared items of the group");
    await this.addItems(trueMoney, [
      ["True Money backdrop", "Graphics", 0, "piece", 3],
      ["Branded payment kiosk", "Screens", 0, "piece", 4],
      ["Orange bean bag", "Furniture", 0, "piece", 10],
    ]);
    const trueSim = await this.company("customer", "True Sim", "Hla Hla", "truesim");
    this.note(trueSim, "customer", "In True Group: a project made by an admin, a waiting order");
    await this.addItems(trueSim, [
      ["True Sim arch", "Graphics", 0, "piece", 2],
      ["SIM card display", "Furniture", 0, "piece", 12],
    ]);
    const group = await parts.organizationService.create("True Group");
    await parts.organizationService.addCompany(group.id, trueMoney.companyId);
    await parts.organizationService.addCompany(group.id, trueSim.companyId);

    const tea = await this.company("customer", "Mandalay Tea House", "Daw Khin", "tea");
    this.note(tea, "customer", "Not in a group: done projects, a rejected order");
    const teaBuyer = await parts.userService.create(tea, this.person("Min Thu", "buyer@tea.test"));
    this.note(teaBuyer, "customer", "A second user (not the owner)");
    const robots = await this.company("customer", "Shwe Robotics", "Kyaw Zaw", "robots");
    this.note(robots, "customer", "Cancelled orders to add again, a cancelled project");
    const crafts = await this.company("customer", "Old Bagan Crafts", "U Tin", "crafts");
    this.note(crafts, "customer (disabled)", "Cannot log in: the company is disabled");

    // ---- The past.
    this.at(-75);
    const teaFair = await this.project(
      tea,
      "Tea & Coffee Fair",
      -50,
      -48,
      "Yangon Convention Centre",
    );
    await this.add(tea, teaFair, "Bistro table", 6);
    await this.add(tea, teaFair, "Bar stool", 24);
    await this.add(tea, teaFair, "Shell scheme booth 6 × 3 m", 1);
    await this.add(tea, teaFair, "Grey carpet", 18);
    for (const order of await this.send(tea, teaFair, "Please deliver one day before.")) {
      await this.answer(order, [nordic, golden], "complete");
    }
    await parts.projectService.markDone(tea, teaFair);

    this.at(-50);
    const telecom = await this.project(trueSim, "Telecom Days", -20, -18, "MICT Park, Yangon");
    await this.add(trueSim, telecom, "55 inch screen on stand", 4);
    await this.add(trueSim, telecom, "LED spot light", 12);
    await this.add(trueSim, telecom, "True Sim arch", 1);
    for (const order of await this.send(trueSim, telecom)) {
      await this.answer(order, [lumen], "complete");
    }
    await parts.projectService.markDone(trueSim, telecom);

    this.at(-40);
    const robotWorld = await this.project(
      robots,
      "Robot World",
      -10,
      -8,
      "Mandalay Expo Hall, Mandalay",
    );
    await this.add(robots, robotWorld, "Island booth 6 × 6 m", 1);
    await this.add(robots, robotWorld, "Touch screen kiosk", 2);
    for (const order of await this.send(robots, robotWorld)) {
      if (order.supplierCompanyId === golden.companyId) {
        await parts.orderService.reject(
          golden,
          order.id,
          "Both island booths are in repair until the end of the month.",
        );
      } else {
        await this.answer(order, [lumen], "complete");
      }
    }
    await parts.projectService.markDone(robots, robotWorld);

    // Everything up to here is old news: every user has read it.
    for (const user of [
      admin,
      ops,
      golden,
      goldenSales,
      lumen,
      nordic,
      trueSim,
      tea,
      teaBuyer,
      robots,
    ]) {
      await parts.notificationService.markAllRead(user);
    }

    // ---- Now. Events in the weeks to come.
    this.at(-6);
    const craftMarket = await this.project(
      crafts,
      "Craft Market",
      35,
      36,
      "Bagan Riverside, Bagan",
    );
    await this.add(crafts, craftMarket, "Folding chair", 40);
    await this.add(crafts, craftMarket, "Roll-up banner", 4);
    for (const order of await this.send(crafts, craftMarket)) {
      if (order.supplierCompanyId === nordic.companyId) {
        await parts.orderService.accept(nordic, order.id);
      }
    }

    this.at(-5);
    const banking = await this.project(
      trueMoney,
      "Banking Tech Fair",
      60,
      62,
      "Yangon Convention Centre",
    );
    await this.add(trueMoney, banking, "Shell scheme booth 3 × 3 m", 2);
    await this.add(trueMoney, banking, "Printed back wall 3 m", 2);
    await this.add(trueMoney, banking, "LED video wall 3 × 2 m", 1);
    await this.add(trueMoney, banking, "Bar stool", 24);
    await this.add(trueMoney, banking, "Reception counter", 2);
    await this.add(trueMoney, banking, "True Money backdrop", 1);
    for (const order of await this.send(trueMoney, banking, "Our logo files come by Friday.")) {
      await this.answer(order, [golden, lumen, nordic], "accept");
    }
    // Things break: the stock goes below what is booked. My items then shows a warning.
    await parts.itemService.update(nordic, this.item("Bar stool").id, { stock: 10 });

    this.at(-4);
    const food = await this.project(tea, "Food & Drink Asia", 59, 61, "Yangon Convention Centre");
    await this.add(tea, food, "Shell scheme booth 3 × 3 m", 1);
    await this.add(tea, food, "Truss lighting rig 6 m", 4);
    await this.add(tea, food, "Info counter with logo", 1);
    for (const order of await this.send(tea, food, "We need power for two fridges.")) {
      if (order.supplierCompanyId === golden.companyId) {
        await parts.orderService.accept(golden, order.id);
      } else if (order.supplierCompanyId === lumen.companyId) {
        await parts.orderService.reject(
          lumen,
          order.id,
          "All four rigs are booked for a concert on these days. We can offer two.",
        );
      }
      // The order for the item of the platform stays waiting: "Orders for our items".
    }

    this.at(-3);
    const automation = await this.project(
      robots,
      "Automation Asia",
      20,
      22,
      "Mandalay Expo Hall, Mandalay",
    );
    await this.add(robots, automation, "Lounge sofa", 2);
    await this.add(robots, automation, "Brochure rack", 3);
    await this.add(robots, automation, "Moving head light", 6);
    for (const order of await this.send(robots, automation)) {
      if (order.supplierCompanyId === nordic.companyId) {
        await parts.orderService.accept(nordic, order.id);
        await parts.orderService.cancel(
          nordic,
          order.id,
          "Our truck broke down. We cannot deliver to Mandalay that week. Sorry.",
        );
      } else {
        await parts.orderService.cancel(robots, order.id);
      }
    }
    const maker = await this.project(robots, "Maker Faire", 25, 26, "Mandalay Expo Hall, Mandalay");
    await this.add(robots, maker, "Fascia name board", 2);
    await this.send(robots, maker);
    await parts.projectService.cancel(robots, maker);

    this.at(-2);
    const summit = await this.project(
      trueMoney,
      "Mobile Money Summit",
      45,
      47,
      "MICT Park, Yangon",
    );
    await this.add(trueMoney, summit, "Shell scheme booth 6 × 3 m", 1);
    await this.add(trueMoney, summit, "Wood look vinyl floor", 18);
    await this.add(trueMoney, summit, "LED video wall 3 × 2 m", 1);
    await this.add(trueMoney, summit, "SIM card display", 2);
    for (const order of await this.send(trueMoney, summit)) {
      if (order.supplierCompanyId === lumen.companyId) {
        await parts.orderService.accept(lumen, order.id);
      }
    }

    // An admin acts as True Sim and makes a project for them. The project says so.
    this.at(-1);
    const acting = await parts.authService.impersonate(admin, trueSim.companyId);
    const asTrueSim = await parts.authService.authenticate(acting.token);
    const roadshow = await this.project(
      asTrueSim,
      "5G Launch Roadshow",
      61,
      63,
      "Yangon Convention Centre",
    );
    // Banking Tech Fair holds 2 and Food & Drink Asia holds 1 of the 4 booths on these days.
    await this.add(asTrueSim, roadshow, "Shell scheme booth 3 × 3 m", 1);
    await this.add(asTrueSim, roadshow, "55 inch screen on stand", 2);
    await this.send(asTrueSim, roadshow, "Sent by the platform team for True Sim.");
    await parts.authService.stopImpersonating(asTrueSim, acting.token);

    this.at(0);
    // The last free booth breaks. The waiting order of True Sim is now short of 1: the
    // supplier sees it on the order page before the click on "Accept".
    await parts.itemService.update(golden, this.item("Shell scheme booth 3 × 3 m").id, {
      stock: 3,
    });

    const fintech = await this.project(
      trueMoney,
      "Fintech Expo",
      30,
      33,
      "Naypyitaw Fair Ground, Naypyitaw",
    );
    await this.add(trueMoney, fintech, "Shell scheme booth 6 × 3 m", 1);
    await this.add(trueMoney, fintech, "Bistro table", 3);
    await this.add(trueMoney, fintech, "LED spot light", 8);
    await this.add(trueMoney, fintech, "Branded payment kiosk", 2);
    await this.add(trueMoney, fintech, "SIM card display", 1);

    // The last step: the company is disabled. Its waiting order is cancelled by the platform,
    // its accepted order stays.
    await parts.companyService.update(admin, crafts.companyId, { disabled: true });
    return this.accounts;
  }

  // ---------------------------------------------------------------- small helpers

  private at(daysFromNow: number): void {
    this.parts.setDaysFromNow(daysFromNow);
  }

  /** A day as YYYY-MM-DD, counted from the real today. */
  private day(daysFromToday: number): string {
    return new Date(Date.now() + daysFromToday * DAY_MS).toISOString().slice(0, 10);
  }

  private person(name: string, email: string) {
    return { name, email, password: this.password };
  }

  private account(role: RegisterInput["role"], companyName: string, name: string, email: string) {
    return { ...this.person(name, email), role, companyName };
  }

  private note(user: User, role: string, tryIt: string): void {
    this.accounts.push({ email: user.email, role, company: user.companyName, tryIt });
  }

  /** A company that an admin made: approved at once. Returns its owner. */
  private async company(
    role: RegisterInput["role"],
    companyName: string,
    ownerName: string,
    domain: string,
  ): Promise<User> {
    const company = await this.parts.companyService.create(
      this.account(role, companyName, ownerName, `owner@${domain}.test`),
    );
    const owner = await this.ownerOf(company);
    await this.profile(owner, companyName);
    return owner;
  }

  private async ownerOf(company: Company): Promise<User> {
    const owner = await this.parts.users.findOwner(company.id);
    if (!owner) {
      throw new Error(`${company.name} has no owner.`);
    }
    return owner;
  }

  private async profile(owner: User, companyName: string): Promise<void> {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    await this.parts.companyService.updateMine(owner, {
      phone: `+95 9 ${String(400000000 + this.accounts.length * 1234567).slice(0, 9)}`,
      address: `No. ${12 + this.accounts.length}, Pyay Road\nYangon, Myanmar`,
      website: `https://${slug}.example`,
      about: `${companyName} works at trade fairs in Yangon, Mandalay and Naypyitaw since 2015.`,
    });
  }

  /** Makes the items of one company. Every item gets all its fields and one or two photos. */
  private async addItems(owner: User, specs: ItemSpec[]): Promise<void> {
    let number = 0;
    for (const [name, category, priceCents, unit, stock] of specs) {
      number += 1;
      const detail = DETAILS[category] as (typeof DETAILS)[string];
      const item = await this.parts.itemService.create(owner, {
        name,
        category,
        priceCents,
        unit,
        stock,
        sku: `${category.slice(0, 3).toUpperCase()}-${String(number).padStart(3, "0")}`,
        description: `${name}. Delivered, set up and taken down by ${owner.companyName}.`,
        widthCm: detail.size[0],
        heightCm: detail.size[1],
        depthCm: detail.size[2],
        weightKg: 2.5 * number,
        color: detail.color,
        material: detail.material,
      });
      this.items.set(name, item);
      for (let photo = 0; photo < (number % 3 === 0 ? 2 : 1); photo++) {
        await this.parts.itemService.addPhoto(owner, item.id, this.photo(category));
      }
    }
  }

  private item(name: string): Item {
    const item = this.items.get(name);
    if (!item) {
      throw new Error(`The seeder has no item "${name}".`);
    }
    return item;
  }

  private async project(
    user: User,
    name: string,
    startsIn: number,
    endsIn: number,
    venue: string,
  ): Promise<string> {
    const [place, city = "Yangon"] = venue.split(", ");
    const project = await this.parts.projectService.create(user, {
      name,
      startsOn: this.day(startsIn),
      endsOn: this.day(endsIn),
      setupOn: this.day(startsIn - 1),
      venue: place,
      city,
      hall: `Hall ${1 + (name.length % 4)}`,
      boothNumber: `${String.fromCharCode(65 + (name.length % 6))}-${10 + name.length}`,
      boothWidthCm: 600,
      boothDepthCm: 300,
      notes: "Setup starts at 8:00. Call the owner at the gate.",
    });
    return project.id;
  }

  private async add(user: User, projectId: string, itemName: string, quantity: number) {
    const input = { itemId: this.item(itemName).id, quantity };
    await this.parts.projectService.addLine(user, projectId, input);
  }

  /** Sends the lines that are not sent yet, with the total the customer sees. */
  private async send(user: User, projectId: string, note = ""): Promise<Order[]> {
    const before = await this.parts.projectService.get(user, projectId);
    let expectedTotalCents = 0;
    for (const line of before.lines) {
      if (line.state === "not_sent") {
        expectedTotalCents += line.unitPriceCents * line.quantity;
      }
    }
    const sent = await this.parts.projectService.send(user, projectId, {
      note,
      expectedTotalCents,
    });
    const fresh: Order[] = [];
    for (const order of sent.orders) {
      if (order.status === "pending") {
        fresh.push(order);
      }
    }
    return fresh;
  }

  /** The supplier of the order accepts it, and completes it when asked. */
  private async answer(order: Order, suppliers: User[], action: "accept" | "complete") {
    for (const supplier of suppliers) {
      if (supplier.companyId === order.supplierCompanyId) {
        await this.parts.orderService.accept(supplier, order.id);
        if (action === "complete") {
          await this.parts.orderService.complete(supplier, order.id);
        }
      }
    }
  }

  /**
   * A small PNG made here, with no package: a wall, a floor and a box in the colour of
   * the category. Every photo gets a slightly other shade, so a gallery shows the change.
   */
  private photo(category: string): File {
    const width = 480;
    const height = 360;
    const shade = (this.photoCount++ % 5) * 14;
    const [red, green, blue] = COLOURS[category] ?? [100, 100, 100];
    // Each row starts with one byte for the filter (0: none), then 3 bytes per pixel.
    const raw = new Uint8Array((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
      const row = y * (width * 3 + 1);
      for (let x = 0; x < width; x++) {
        const inBox = x > 150 && x < 330 && y > 110 + shade && y < 270;
        const floor = y > 270;
        const at = row + 1 + x * 3;
        raw[at] = inBox ? red : floor ? 214 - shade : 243;
        raw[at + 1] = inBox ? green : floor ? 211 - shade : 241;
        raw[at + 2] = inBox ? blue : floor ? 205 - shade : 236;
      }
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    // 8 bits per colour, colour type 2 (RGB).
    header.set([8, 2, 0, 0, 0], 8);
    const png = Buffer.concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      this.chunk("IHDR", header),
      this.chunk("IDAT", deflateSync(raw)),
      this.chunk("IEND", new Uint8Array(0)),
    ]);
    return new File([png], `${category}.png`, { type: "image/png" });
  }

  /** One part of a PNG file: length, name, data, checksum. */
  private chunk(name: string, data: Uint8Array): Uint8Array {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(name));
    body.set(data, 4);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(body, 4);
    view.setUint32(8 + data.length, Bun.hash.crc32(body));
    return chunk;
  }
}
