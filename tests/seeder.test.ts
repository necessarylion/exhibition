import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { DAY_MS } from "../app/constants/time.constants";
import { DEFAULT_SEED_PASSWORD, type SeededAccount, Seeder } from "../database/seeder";
import { buildApp, Client, type TestApp } from "./support/build-app";

const API = "/api/v1";

/** `bun run seed` (D12). The seeder goes through the services, so every rule holds. */
describe("the seeder", () => {
  let context: TestApp;
  let client: Client;
  let seeder: Seeder;
  let accounts: SeededAccount[];

  function setDaysFromNow(days: number) {
    context.clock.time = Date.now() + days * DAY_MS;
  }

  async function count(table: string): Promise<number> {
    const [row] = await context.sql.unsafe(`SELECT COUNT(*) AS total FROM ${table}`);
    return Number(row.total);
  }

  /** How many rows each value of a column has, like `{ pending: 4, accepted: 6 }`. */
  async function groups(query: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const row of await context.sql.unsafe(query)) {
      result[String(row.name)] = Number(row.total);
    }
    return result;
  }

  async function token(email: string): Promise<string> {
    const login = await client.login(email, DEFAULT_SEED_PASSWORD);
    expect(login.status).toBe(200);
    return login.token;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    seeder = new Seeder({ ...context, setDaysFromNow });
    expect(await seeder.hasData()).toBe(false);
    accounts = await seeder.run();
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("it makes the companies, users and items of the brief", async () => {
    expect(await seeder.hasData()).toBe(true);
    expect(
      await groups("SELECT type AS name, COUNT(*) AS total FROM companies GROUP BY type"),
    ).toEqual({
      admin: 1,
      supplier: 4,
      customer: 5,
    });
    expect(accounts.length).toBe(13);
    expect(await count("users")).toBe(13);
    const waiting = await context.sql`
      SELECT name FROM companies WHERE type = 'supplier' AND approved_at IS NULL
    `;
    expect(waiting.map((row: { name: string }) => row.name)).toEqual(["Fresh Booth Co"]);
    const disabled = await context.sql`SELECT name FROM companies WHERE disabled_at IS NOT NULL`;
    expect(disabled.map((row: { name: string }) => row.name)).toEqual(["Old Bagan Crafts"]);
    // The group and its two companies.
    const group = await context.sql`
      SELECT companies.name FROM companies JOIN organizations
        ON organizations.id = companies.organization_id
      WHERE organizations.name = 'True Group' ORDER BY companies.name
    `;
    expect(group.map((row: { name: string }) => row.name)).toEqual(["True Money", "True Sim"]);

    // Every supplier has 6 to 10 items in several categories. Every item has all its fields.
    const perSupplier = await groups(`
      SELECT companies.name AS name, COUNT(*) AS total FROM items
      JOIN companies ON companies.id = items.company_id
      WHERE companies.type = 'supplier' GROUP BY companies.name
    `);
    expect(Object.keys(perSupplier).length).toBe(4);
    for (const total of Object.values(perSupplier)) {
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(10);
    }
    const categories = await groups(
      "SELECT category AS name, COUNT(*) AS total FROM items GROUP BY category",
    );
    expect(Object.keys(categories).sort()).toEqual([
      "Booth",
      "Flooring",
      "Furniture",
      "Graphics",
      "Lighting",
      "Screens",
    ]);
    const empty = await context.sql`
      SELECT name FROM items WHERE sku IS NULL OR description = '' OR width_cm IS NULL
        OR weight_grams IS NULL OR color IS NULL OR material IS NULL
    `;
    expect(empty.length).toBe(0);
    const units = await groups("SELECT unit AS name, COUNT(*) AS total FROM items GROUP BY unit");
    expect(Object.keys(units).length).toBe(4);
    expect(await count("items WHERE stock IS NOT NULL")).toBeGreaterThan(10);
    expect(await count("items WHERE stock IS NULL")).toBeGreaterThan(3);
    expect(await count("items WHERE hidden_at IS NOT NULL")).toBe(1);
    // Every company has its profile.
    expect(await count("companies WHERE type <> 'admin' AND (phone = '' OR about = '')")).toBe(0);
  });

  test("every item has a photo that is a real image file", async () => {
    expect(await count("items WHERE id NOT IN (SELECT item_id FROM item_photos)")).toBe(0);
    const files = await readdir(`${context.config.storageDir}/uploads`);
    expect(files.length).toBe(await count("item_photos"));
    const photo = await context.app.request(`/uploads/${files[0]}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    // A PNG starts with these bytes and ends with the IEND part.
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new TextDecoder().decode(bytes.slice(-8, -4))).toBe("IEND");
  });

  test("it has projects and orders in every status, with dates around today", async () => {
    const orders = await groups(`
      SELECT status || COALESCE(' by ' || cancelled_by, '') AS name, COUNT(*) AS total
      FROM orders GROUP BY status, cancelled_by
    `);
    for (const status of [
      "pending",
      "accepted",
      "completed",
      "rejected",
      "cancelled by customer",
      "cancelled by supplier",
      "cancelled by admin",
    ]) {
      expect(orders[status] ?? 0).toBeGreaterThan(0);
    }
    expect(await count("orders WHERE status = 'rejected' AND reject_reason IS NULL")).toBe(0);

    const admin = await token("admin@exhibition.test");
    const response = await client.send("GET", `${API}/projects?limit=200`, admin);
    const projects = await response.json();
    expect(projects.length).toBe(11);
    const statuses = JSON.parse(response.headers.get("X-Counts") ?? "{}");
    for (const status of ["draft", "waiting", "confirmed", "done", "cancelled"]) {
      expect(statuses[status]).toBeGreaterThan(0);
    }
    const today = new Date().toISOString().slice(0, 10);
    const future = projects.filter((project: { startsOn: string }) => project.startsOn > today);
    expect(future.length).toBeGreaterThanOrEqual(7);
    // The first row is the next event.
    expect(projects[0].startsOn > today).toBe(true);
    // Old orders were made in the past, so the chart of a supplier has more than one month.
    const months = await groups(
      "SELECT SUBSTR(created_at, 1, 7) AS name, COUNT(*) AS total FROM orders GROUP BY 1",
    );
    expect(Object.keys(months).length).toBeGreaterThanOrEqual(2);
    // One project was made by the admin for a customer.
    const made = projects.filter(
      (project: { createdByAdminName: string | null }) => project.createdByAdminName,
    );
    expect(made.map((project: { name: string }) => project.name)).toEqual(["5G Launch Roadshow"]);
    expect(await count("admin_actions")).toBe(1);
    // No "acting" session is left open.
    expect(await count("access_tokens WHERE impersonator_id IS NOT NULL")).toBe(0);
  });

  test("the draft of True Money has own, shared and supplier lines", async () => {
    const owner = await token("owner@truemoney.test");
    const projects = await client.json(`${API}/projects?status=draft`, owner);
    const draft = await client.json(`${API}/projects/${projects[0].id}`, owner);
    const states = new Set<string>();
    for (const line of draft.lines) {
      states.add(line.state);
    }
    expect([...states].sort()).toEqual(["not_sent", "own", "shared"]);
    // The catalog shows the items of the group as shared, and nothing of the waiting supplier.
    const catalog = await client.json(`${API}/items/catalog?limit=200`, owner);
    const names = catalog.map((item: { name: string }) => item.name);
    expect(names).toContain("SIM card display");
    expect(names).not.toContain("Pop-up booth 3 × 2 m");
    expect(names).not.toContain("Glass showcase");
  });

  test("two projects on the same days want the same limited booth, and one order is short", async () => {
    const supplier = await token("owner@golden.test");
    const waiting = await client.json(`${API}/orders?status=pending&q=5G`, supplier);
    expect(waiting.length).toBe(1);
    const order = await client.json(`${API}/orders/${waiting[0].id}`, supplier);
    const booth = order.lines.find((line: { itemName: string }) =>
      line.itemName.startsWith("Shell"),
    );
    expect(booth).toMatchObject({ quantity: 1, stock: 3, available: 0 });
    expect((await client.send("POST", `${API}/orders/${order.id}/accept`, supplier)).status).toBe(
      409,
    );
    // An item whose stock went below what is booked shows the days.
    const nordic = await token("owner@nordic.test");
    const stools = await client.json(`${API}/items/mine?q=bar%20stool`, nordic);
    expect(stools[0].stock).toBe(10);
    expect(stools[0].overbooked.length).toBe(1);
    expect(stools[0].overbooked[0].booked).toBe(24);
  });

  test("every account logs in with the one password, but the disabled company does not", async () => {
    for (const account of accounts) {
      const login = await client.login(account.email, DEFAULT_SEED_PASSWORD);
      expect(login.status).toBe(account.role.includes("disabled") ? 403 : 200);
    }
    // Every role has something on every list page.
    const pages: [string, string[]][] = [
      [
        "admin@exhibition.test",
        ["/projects", "/orders", "/items/mine", "/notifications", "/organizations"],
      ],
      ["owner@golden.test", ["/orders", "/items/mine", "/notifications", "/users"]],
      [
        "owner@truemoney.test",
        ["/projects", "/orders", "/items/mine", "/items/catalog", "/notifications"],
      ],
      ["owner@tea.test", ["/projects", "/orders", "/notifications", "/users"]],
    ];
    for (const [email, paths] of pages) {
      const mine = await token(email);
      for (const path of paths) {
        expect((await client.json(`${API}${path}`, mine)).length).toBeGreaterThan(0);
      }
    }
    // Read and unread notifications.
    expect(await count("notifications WHERE read_at IS NOT NULL")).toBeGreaterThan(5);
    expect(await count("notifications WHERE read_at IS NULL")).toBeGreaterThan(5);
  });

  test("it can run again after the tables are emptied, and gives the same data", async () => {
    const before = {
      companies: await count("companies"),
      items: await count("items"),
      projects: await count("projects"),
      orders: await count("orders"),
      lines: await count("project_lines"),
      photos: await count("item_photos"),
    };
    await seeder.empty();
    for (const table of [
      "companies",
      "users",
      "items",
      "projects",
      "orders",
      "notifications",
      "organizations",
    ]) {
      expect(await count(table)).toBe(0);
    }
    expect((await readdir(`${context.config.storageDir}/uploads`)).length).toBe(0);
    // The schema is still there: the migrations are not run again.
    expect(await count("migrations")).toBeGreaterThan(20);

    const again = new Seeder({ ...context, setDaysFromNow }, "another-seed-password");
    expect((await again.run()).length).toBe(13);
    expect({
      companies: await count("companies"),
      items: await count("items"),
      projects: await count("projects"),
      orders: await count("orders"),
      lines: await count("project_lines"),
      photos: await count("item_photos"),
    }).toEqual(before);
    expect((await client.login("owner@truesim.test", "another-seed-password")).status).toBe(200);
    expect((await client.login("owner@truesim.test", DEFAULT_SEED_PASSWORD)).status).toBe(401);
  });

  test("the script refuses to run in production, and a password that is too easy", async () => {
    async function run(env: Record<string, string>) {
      const child = Bun.spawn(["bun", "database/seed.ts"], {
        env: { PATH: Bun.env.PATH ?? "", DATABASE_URL: "sqlite://:memory:", ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await new Response(child.stderr).text();
      return { code: await child.exited, text };
    }
    const production = await run({ NODE_ENV: "production" });
    expect(production.code).toBe(1);
    expect(production.text).toContain("does not run with NODE_ENV=production");
    const easy = await run({ NODE_ENV: "development", SEED_PASSWORD: "password" });
    expect(easy.code).toBe(1);
    expect(easy.text).toContain("too easy to guess");
  });
});
