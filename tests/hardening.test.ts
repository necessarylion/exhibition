import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { AppConfig } from "../app/config/app.config";
import { HealthController } from "../app/controllers/health.controller";
import { isUniqueViolation } from "../app/errors/unique-violation";
import { AccessToken } from "../app/models/access-token.model";
import type { User } from "../app/models/user.model";
import { AdminActionRepository } from "../app/repositories/admin-action.repository";
import type { HealthRepository } from "../app/repositories/health.repository";
import { ItemRepository } from "../app/repositories/item.repository";
import { ProjectRepository } from "../app/repositories/project.repository";
import { TransactionRunner } from "../app/repositories/transaction-runner";
import { UserRepository } from "../app/repositories/user.repository";
import { AuthService } from "../app/services/auth.service";
import { ItemService } from "../app/services/item.service";
import { PhotoStorageService } from "../app/services/photo-storage.service";
import { TokenCleaner } from "../app/services/token-cleaner.service";
import { buildApp, Client, PASSWORD, type TestApp, TestClock } from "./support/build-app";

/** Finds no email. So the check before the insert passes, like in a race of two requests. */
class BlindUserRepository extends UserRepository {
  override async findByEmail(): Promise<User | null> {
    return null;
  }
}

/** Finds no SKU, like in a race of two requests. */
class BlindItemRepository extends ItemRepository {
  override async findIdBySku(): Promise<string | null> {
    return null;
  }
}

describe("hardening", () => {
  let context: TestApp;
  let client: Client;

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("GET /health answers ok without a token", async () => {
    const response = await context.app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("GET /health answers 503 when the database fails", async () => {
    const broken = {
      async ping() {
        throw new Error("The database is down.");
      },
    } as unknown as HealthRepository;
    const controller = new HealthController(broken);
    const app = new Hono().get("/health", controller.check.bind(controller));
    const log = spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request("/health");
    log.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error" });
  });

  test("every response has the security headers", async () => {
    const paths = ["/login", "/health", "/api/v1/users/me", "/no-such-page"];
    for (const path of paths) {
      const { headers } = await context.app.request(path);
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
      expect(headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    }

    // Development: the Vite dev server is allowed, with http and with a web socket.
    const policy = (await context.app.request("/login")).headers.get("Content-Security-Policy");
    expect(policy).toContain("script-src 'self' http://localhost:5173;");
    expect(policy).toContain("ws://localhost:5173");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  test("production: scripts only from the app, and the docs page is off until API_DOCS", async () => {
    const env = { NODE_ENV: "production", DATABASE_URL: "sqlite://unused", LOG_REQUESTS: "false" };
    const production = await buildApp(env);
    const withDocs = await buildApp({ ...env, API_DOCS: "true" });

    const { headers } = await production.app.request("/health");
    const policy = headers.get("Content-Security-Policy");
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("unsafe-eval");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");

    expect((await production.app.request("/docs")).status).toBe(404);
    // The description of the API is off together with its docs page.
    expect((await production.app.request("/api/v1/openapi.json")).status).toBe(404);
    expect((await withDocs.app.request("/api/v1/openapi.json")).status).toBe(200);
    const docs = await withDocs.app.request("/docs");
    expect(docs.status).toBe(200);
    // Only the docs page may load the script of the docs from the CDN.
    expect(docs.headers.get("Content-Security-Policy")).toContain("https://cdn.jsdelivr.net");
    const page = await withDocs.app.request("/health");
    expect(page.headers.get("Content-Security-Policy")).not.toContain("jsdelivr");

    await production.sql.close();
    await withDocs.sql.close();
    // The two apps above emptied a PostgreSQL test database. Start again for the next tests.
    await context.sql.close();
    context = await buildApp();
    client = new Client(context.app);
  });

  test("the docs page is on in development", async () => {
    const docs = await context.app.request("/docs");

    expect(docs.status).toBe(200);
    expect(docs.headers.get("Content-Security-Policy")).toContain("https://cdn.jsdelivr.net");
    expect(docs.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("the request log has the method, path, status and time, and no secrets", async () => {
    const logged = await buildApp({ LOG_REQUESTS: "true" });
    const log = spyOn(console, "log").mockImplementation(() => {});

    await logged.app.request("/api/v1/users/me?secret=query-value", {
      headers: { Authorization: "Bearer secret-token-value" },
    });
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    await logged.sql.close();
    context = await buildApp();
    client = new Client(context.app);

    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^GET \/api\/v1\/users\/me 401 \d+ms$/);
  });

  test("a second sign-up that slips past the email check gets 409 and saves nothing", async () => {
    await client.signUp("customer", "race@hard.example", "First Co");
    const blind = new AuthService(
      new BlindUserRepository(context.sql),
      context.companies,
      context.tokens,
      context.config,
      context.clock,
      context.notificationService,
      new AdminActionRepository(context.sql),
    );
    const input = {
      name: "Second",
      email: "race@hard.example",
      password: PASSWORD,
      role: "customer" as const,
      companyName: "Leftover Co",
    };

    expect(blind.register(input)).rejects.toMatchObject({ status: 409, code: "email_taken" });
    await blind.register(input).catch(() => {});

    // One transaction: the company of the failed sign-up is not there.
    const rows = await context.sql`SELECT id FROM companies WHERE name = 'Leftover Co'`;
    expect(rows.length).toBe(0);
    // Adding a user to a company takes the same path.
    const company = await context.companies.findFirstByType("customer");
    if (!company) {
      throw new Error("No company.");
    }
    expect(blind.addUser(input, company)).rejects.toMatchObject({ code: "email_taken" });
  });

  // On SQLite the two transactions run one after the other (`TransactionRunner`).
  test("two sign-ups with one email at the same moment: one works", async () => {
    const body = {
      name: "Twin",
      email: "twin@hard.example",
      password: PASSWORD,
      role: "supplier",
      companyName: "Twin Co",
    };

    const responses = await Promise.all([
      client.post("/api/v1/auth/register", body),
      client.post("/api/v1/auth/register", body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rows = await context.sql`SELECT id FROM companies WHERE name = 'Twin Co'`;
    expect(rows.length).toBe(1);
  });

  test("rows made in the same millisecond keep the order they were made in", () => {
    const clock = new TestClock();

    const stamps = [clock.timestamp(), clock.timestamp(), clock.timestamp()];

    expect(stamps[0]).toBe(new Date(clock.time).toISOString());
    expect(stamps).toEqual([...new Set(stamps)].sort());
  });

  test("a SKU that slips past the check gets 409 sku_taken", async () => {
    const { user } = await client.signUp("supplier", "sku@hard.example", "Sku Co");
    const owner = (await context.users.findById(user.id)) as User;
    const items = new ItemService(
      new BlindItemRepository(context.sql),
      new PhotoStorageService(context.config),
      new ProjectRepository(context.sql, new TransactionRunner(context.sql)),
      context.clock,
    );
    const input = { name: "One", category: "Stand", priceCents: 1, sku: "RACE-1" };
    const first = await items.create(owner, input);
    const other = await items.create(owner, { ...input, name: "Other", sku: "RACE-2" });

    expect(items.create(owner, { ...input, name: "Two" })).rejects.toMatchObject({
      status: 409,
      code: "sku_taken",
    });
    expect(items.update(owner, other.id, { sku: "RACE-1" })).rejects.toMatchObject({
      code: "sku_taken",
    });
    expect((await items.update(owner, first.id, { sku: "RACE-1" })).sku).toBe("RACE-1");
  });

  test("isUniqueViolation knows only UNIQUE errors", async () => {
    const now = new Date().toISOString();
    const insert = () =>
      context.sql`INSERT INTO companies (id, name, type, created_at) VALUES ('same', 'A', 'customer', ${now})`;
    await insert();
    const unique = await insert().catch((error: unknown) => error);
    const notNull = await context.sql`INSERT INTO companies (id) VALUES ('x')`.catch(
      (error: unknown) => error,
    );

    expect(isUniqueViolation(unique)).toBe(true);
    expect(isUniqueViolation(notNull)).toBe(false);
    expect(isUniqueViolation(new Error("Other"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    await context.sql`DELETE FROM companies WHERE id = 'same'`;
  });

  describe("order numbers and sends at the same moment", () => {
    let customer: string;
    let itemId: string;

    async function projectWithLine(name: string) {
      const body = { name, startsOn: "2026-11-20", endsOn: "2026-11-21" };
      const id = (await (await client.send("POST", "/api/v1/projects", customer, body)).json()).id;
      await client.send("POST", `/api/v1/projects/${id}/lines`, customer, { itemId, quantity: 1 });
      return id as string;
    }

    function send(projectId: string) {
      return client.sendProject(projectId, customer);
    }

    beforeAll(async () => {
      const supplier = (await client.signUp("supplier", "num@hard.example", "Number Supply")).token;
      customer = (await client.signUp("customer", "numc@hard.example", "Number Buyer")).token;
      const item = { name: "Number booth", category: "Stand", priceCents: 100 };
      itemId = (await (await client.send("POST", "/api/v1/items", supplier, item)).json()).id;
    });

    test("an order number that is taken is replaced by a new one, up to 5 tries", async () => {
      const service = context.projectService;
      const real = service.newOrderNumber.bind(service);
      const numbers = ["ORD-TAKEN", "ORD-TAKEN", "ORD-TAKEN", "ORD-FREE"];
      service.newOrderNumber = async (db, attempt) => numbers.shift() ?? real(db, attempt);

      // 1st send takes the number. 2nd send: taken twice, then free.
      expect((await send(await projectWithLine("Number one"))).status).toBe(200);
      const second = await send(await projectWithLine("Number two"));
      expect(second.status).toBe(200);
      expect((await second.json()).orders[0].number).toBe("ORD-FREE");

      // Taken every time: the send fails and nothing of it is saved.
      service.newOrderNumber = async () => "ORD-TAKEN";
      const log = spyOn(console, "error").mockImplementation(() => {});
      const third = await projectWithLine("Number three");
      expect((await send(third)).status).toBe(500);
      log.mockRestore();
      service.newOrderNumber = real;
      const detail = await client.json(`/api/v1/projects/${third}`, customer);
      expect(detail.orders).toEqual([]);
      expect(detail.lines[0].state).toBe("not_sent");
    });

    test("two sends of one project at the same moment: one works", async () => {
      const id = await projectWithLine("Twice");

      const responses = await Promise.all([send(id), send(id)]);

      // The second one waits for the lock. Then it has nothing left to send.
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect((await client.json(`/api/v1/projects/${id}`, customer)).orders.length).toBe(1);
    });
  });

  test("the lists take limit and offset and tell the total in X-Total-Count", async () => {
    const supplier = (await client.signUp("supplier", "page@hard.example", "Page Supply")).token;
    const buyer = (await client.signUp("customer", "pagec@hard.example", "Page Buyer")).token;
    const ids: string[] = [];
    for (const name of ["Page A", "Page B", "Page C"]) {
      const item = { name, category: "Stand", priceCents: 100 };
      ids.push((await (await client.send("POST", "/api/v1/items", supplier, item)).json()).id);
    }

    async function page(path: string, token: string) {
      const response = await client.send("GET", path, token);
      expect(response.status).toBe(200);
      const rows = (await response.json()) as { name: string; status: string }[];
      return { total: response.headers.get("X-Total-Count"), rows, names: rows.map((r) => r.name) };
    }

    // Items.
    expect(await page("/api/v1/items/mine", supplier)).toMatchObject({
      total: "3",
      names: ["Page A", "Page B", "Page C"],
    });
    expect(await page("/api/v1/items/mine?limit=2", supplier)).toMatchObject({
      total: "3",
      names: ["Page A", "Page B"],
    });
    expect(await page("/api/v1/items/mine?limit=2&offset=2", supplier)).toMatchObject({
      total: "3",
      names: ["Page C"],
    });
    expect(await page("/api/v1/items/mine?offset=10", supplier)).toMatchObject({
      total: "3",
      names: [],
    });
    const catalog = await page("/api/v1/items/catalog?limit=1", buyer);
    expect(catalog.rows.length).toBe(1);
    expect(Number(catalog.total)).toBeGreaterThanOrEqual(3);
    for (const query of ["limit=0", "limit=201", "limit=x", "offset=-1", "limit=1.5"]) {
      expect((await client.send("GET", `/api/v1/items/mine?${query}`, supplier)).status).toBe(422);
      expect((await client.send("GET", `/api/v1/orders?${query}`, supplier)).status).toBe(422);
    }

    // Orders: three projects, one order each. The newest is first.
    for (const [index, itemId] of ids.entries()) {
      const body = { name: `Page fair ${index}`, startsOn: "2026-11-20", endsOn: "2026-11-21" };
      const id = (await (await client.send("POST", "/api/v1/projects", buyer, body)).json()).id;
      await client.send("POST", `/api/v1/projects/${id}/lines`, buyer, { itemId, quantity: 1 });
      expect((await client.sendProject(id, buyer)).status).toBe(200);
    }
    const all = await page("/api/v1/orders", supplier);
    expect(all.total).toBe("3");
    const middle = await page("/api/v1/orders?limit=1&offset=1", supplier);
    expect(middle.total).toBe("3");
    expect(middle.rows).toEqual([all.rows[1] as (typeof all.rows)[number]]);
    expect((await page("/api/v1/orders?status=accepted&limit=1", supplier)).total).toBe("0");
    expect((await page("/api/v1/orders?status=pending&limit=1", buyer)).total).toBe("3");

    // Projects: the status filter is part of the query, so the total is right.
    const draft = { name: "Page draft", startsOn: "2026-11-20", endsOn: "2026-11-21" };
    await client.send("POST", "/api/v1/projects", buyer, draft);
    const waiting = await page("/api/v1/projects?status=waiting&limit=2", buyer);
    expect(waiting.total).toBe("3");
    expect(waiting.rows.length).toBe(2);
    expect(waiting.rows.every((row) => row.status === "waiting")).toBe(true);
    expect((await page("/api/v1/projects?status=draft", buyer)).names).toEqual(["Page draft"]);
    expect((await page("/api/v1/projects?limit=1&offset=3", buyer)).total).toBe("4");

    // Users and companies.
    expect((await page("/api/v1/users?limit=1", buyer)).total).toBe("1");
    const account = { name: "Root", email: "root@hard.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    const admin = (await client.login(account.email)).token;
    const companies = await page("/api/v1/companies?type=supplier&limit=1", admin);
    expect(companies.rows.length).toBe(1);
    expect(Number(companies.total)).toBeGreaterThanOrEqual(2);
    expect((await page("/api/v1/items?limit=1", admin)).rows.length).toBe(1);
  });

  test("expired tokens are deleted, the others stay", async () => {
    const { user } = await client.signUp("customer", "clean@hard.example", "Clean Co");
    const now = Date.now();
    const old = new Date(now - 1000).toISOString();
    const fresh = new Date(now + 60_000).toISOString();
    await context.tokens.create(
      new AccessToken(crypto.randomUUID(), user.id, "old-hash", old, old),
    );
    await context.tokens.create(
      new AccessToken(crypto.randomUUID(), user.id, "new-hash", fresh, old),
    );

    await new TokenCleaner(
      context.tokens,
      context.notifications,
      context.clock,
      context.adminActions,
    ).run();

    expect(await context.tokens.findByHash("old-hash")).toBeNull();
    expect(await context.tokens.findByHash("new-hash")).not.toBeNull();
  });
});

describe("config", () => {
  test("a wrong value stops the start with a clear message", () => {
    const wrong: [Record<string, string>, string][] = [
      [{ PORT: "abc" }, "PORT"],
      [{ PORT: "0" }, "PORT"],
      [{ PORT: "70000" }, "PORT"],
      [{ PORT: "3000.5" }, "PORT"],
      [{ TOKEN_TTL_DAYS: "0" }, "TOKEN_TTL_DAYS"],
      [{ TOKEN_TTL_DAYS: "-1" }, "TOKEN_TTL_DAYS"],
      [{ TOKEN_TTL_DAYS: "soon" }, "TOKEN_TTL_DAYS"],
      [{ RATE_LIMIT_MAX: "none" }, "RATE_LIMIT_MAX"],
      [{ RATE_LIMIT_IP_MAX: "0" }, "RATE_LIMIT_IP_MAX"],
      [{ TRUSTED_PROXIES: "-1" }, "TRUSTED_PROXIES"],
      [{ TRUSTED_PROXIES: "1.5" }, "TRUSTED_PROXIES"],
      [{ TRUSTED_PROXIES: "yes" }, "TRUSTED_PROXIES"],
      // The old switch is gone. It stops the start, so nobody runs with a wrong client address.
      [{ TRUST_PROXY: "true" }, "TRUSTED_PROXIES"],
      [{ DATABASE_URL: "mysql://user:secret@host/db" }, "DATABASE_URL"],
      [{ DATABASE_URL: "database/dev.sqlite" }, "DATABASE_URL"],
      [{ NODE_ENV: "production" }, "DATABASE_URL"],
    ];
    for (const [env, name] of wrong) {
      expect(() => new AppConfig(env)).toThrow(name);
    }
    // The URL can hold a password. It is not in the message.
    expect(() => new AppConfig({ DATABASE_URL: "mysql://user:secret@host/db" })).not.toThrow(
      "secret",
    );
  });

  test("good values and the defaults", () => {
    for (const url of [
      "sqlite://x.sqlite",
      "sqlite::memory:",
      "postgres://h/db",
      "postgresql://h/db",
    ]) {
      expect(new AppConfig({ DATABASE_URL: url }).databaseUrl).toBe(url);
    }
    expect(new AppConfig({})).toMatchObject({
      port: 3000,
      tokenTtlDays: 30,
      rateLimitMax: 10,
      rateLimitIpMax: 50,
      trustedProxies: 0,
      apiDocs: true,
      logRequests: true,
    });
    expect(new AppConfig({ NODE_ENV: "test" }).logRequests).toBe(false);
    const production = new AppConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://h/db" });
    expect(production).toMatchObject({ apiDocs: false, logRequests: true });
    expect(
      new AppConfig({ PORT: "8080", TOKEN_TTL_DAYS: "0.5", TRUSTED_PROXIES: "2" }),
    ).toMatchObject({ port: 8080, tokenTtlDays: 0.5, trustedProxies: 2 });
  });
});
