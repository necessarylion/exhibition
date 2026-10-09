import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DOCS_SCRIPT_URL, MAX_JSON_BODY_BYTES } from "../app/constants/api.constants";
import { MAX_COMPANY_ITEMS } from "../app/constants/item.constants";
import { Migrator } from "../database/migrator";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const API = "/api/v1";
const WINDOW_MS = 15 * 60 * 1000;

describe("attempt limits", () => {
  function login(app: TestApp["app"], email: string, password: string, forwarded?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (forwarded) {
      headers["X-Forwarded-For"] = forwarded;
    }
    return app.request(`${API}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
    });
  }

  test("only wrong logins count: 10 per email in 15 minutes", async () => {
    const context = await buildApp({ RATE_LIMIT_MAX: "10" });
    const client = new Client(context.app);
    await client.signUp("customer", "real@limit.example", "Real Co");

    // A right login is never counted, however often.
    for (let attempt = 1; attempt <= 15; attempt++) {
      expect((await login(context.app, "real@limit.example", PASSWORD)).status).toBe(200);
    }
    // A body that is not valid is no guess, so it does not count.
    for (let attempt = 1; attempt <= 15; attempt++) {
      expect((await login(context.app, "real@limit.example", "")).status).toBe(422);
    }
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect((await login(context.app, "real@limit.example", "wrong-password")).status).toBe(401);
    }
    const blocked = await login(context.app, " Real@Limit.example ", "wrong-password");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("900");
    expect((await blocked.json()).error.code).toBe("too_many_requests");
    // Another email has its own count.
    expect((await login(context.app, "other@limit.example", "wrong-password")).status).toBe(401);
    // TRUSTED_PROXIES is 0, so the header gives no new count.
    const spoofed = await login(context.app, "real@limit.example", "wrong-password", "203.0.113.9");
    expect(spoofed.status).toBe(429);

    context.clock.time += WINDOW_MS - 1000;
    const late = await login(context.app, "real@limit.example", "wrong-password");
    expect(late.headers.get("Retry-After")).toBe("1");
    context.clock.time += 1000;
    expect((await login(context.app, "real@limit.example", PASSWORD)).status).toBe(200);
    await context.sql.close();
  });

  test("one address that tries many emails is stopped by the count per address", async () => {
    const context = await buildApp({ RATE_LIMIT_MAX: "10", RATE_LIMIT_IP_MAX: "3" });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const answer = await login(context.app, `spray${attempt}@limit.example`, "Summer2026!");
      expect(answer.status).toBe(401);
    }
    expect((await login(context.app, "spray4@limit.example", "Summer2026!")).status).toBe(429);
    await context.sql.close();
  });

  test("the client address is counted from the right of X-Forwarded-For", async () => {
    const one = await buildApp({ RATE_LIMIT_IP_MAX: "1", TRUSTED_PROXIES: "1" });
    // Our proxy adds the real address at the end. The values before it come from the client.
    expect(
      (await login(one.app, "a@p.example", "wrong-password", "1.1.1.1, 203.0.113.1")).status,
    ).toBe(401);
    // A new made-up value on the left gives no new count.
    expect(
      (await login(one.app, "b@p.example", "wrong-password", "2.2.2.2, 203.0.113.1")).status,
    ).toBe(429);
    expect((await login(one.app, "c@p.example", "wrong-password", "203.0.113.1")).status).toBe(429);
    // Another real address has its own count.
    expect(
      (await login(one.app, "d@p.example", "wrong-password", "1.1.1.1, 203.0.113.2")).status,
    ).toBe(401);
    await one.sql.close();

    const two = await buildApp({ RATE_LIMIT_IP_MAX: "1", TRUSTED_PROXIES: "2" });
    // Two proxies of our own: the client is the second value from the right.
    expect(
      (await login(two.app, "a@p.example", "wrong-password", "9.9.9.9, 203.0.113.1, 10.0.0.1"))
        .status,
    ).toBe(401);
    expect(
      (await login(two.app, "b@p.example", "wrong-password", "8.8.8.8, 203.0.113.1, 10.0.0.2"))
        .status,
    ).toBe(429);
    expect(
      (await login(two.app, "c@p.example", "wrong-password", "203.0.113.2, 10.0.0.1")).status,
    ).toBe(401);
    // A header that is too short falls back to the address of the connection.
    expect((await login(two.app, "d@p.example", "wrong-password", "203.0.113.3")).status).toBe(401);
    expect((await login(two.app, "e@p.example", "wrong-password", "203.0.113.4")).status).toBe(429);
    await two.sql.close();
  });

  test("the 11th sign-up from one address gets 429", async () => {
    const context = await buildApp({ RATE_LIMIT_MAX: "10" });
    const client = new Client(context.app);
    for (let attempt = 1; attempt <= 10; attempt++) {
      const answer = await client.post(`${API}/auth/register`, { email: `n${attempt}` });
      expect(answer.status).toBe(422);
    }
    const blocked = await client.signUp("customer", "late@limit.example", "Late Co");
    expect(blocked).toMatchObject({ error: { code: "too_many_requests" } });
    context.clock.time += WINDOW_MS;
    expect((await client.signUp("customer", "late@limit.example", "Late Co")).token).toBeString();
    await context.sql.close();
  });

  test("wrong current passwords and added users are limited per acting user", async () => {
    const context = await buildApp({ RATE_LIMIT_MAX: "3", RATE_LIMIT_IP_MAX: "2" });
    const client = new Client(context.app);
    const owner = (await client.signUp("customer", "own@limit.example", "Own Co")).token;
    const other = (await client.signUp("customer", "oth@limit.example", "Oth Co")).token;
    const path = `${API}/users/me/password`;
    const good = { currentPassword: PASSWORD, newPassword: PASSWORD };
    const bad = { currentPassword: "not-my-password", newPassword: "another-password" };

    // A right current password is not counted. The new password must differ from the
    // current one, so the two passwords take turns.
    let current = PASSWORD;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const next = current === PASSWORD ? "another-long-password" : PASSWORD;
      const change = { currentPassword: current, newPassword: next };
      expect((await client.send("POST", path, owner, change)).status).toBe(204);
      current = next;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await client.send("POST", path, owner, bad)).status).toBe(422);
    }
    const blocked = await client.send("POST", path, owner, good);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("too_many_requests");
    expect((await client.send("POST", path, other, bad)).status).toBe(422);

    // Adding users: every call counts, also the one that says "this email has an account".
    const add = `${API}/users`;
    const user = { name: "New", email: "own@limit.example", password: PASSWORD };
    expect((await client.send("POST", add, owner, user)).status).toBe(409);
    expect((await client.send("POST", add, owner, user)).status).toBe(409);
    expect((await client.send("POST", add, owner, user)).status).toBe(429);
    expect((await client.send("POST", add, other, user)).status).toBe(409);
    await context.sql.close();
  });
});

describe("request bodies", () => {
  let context: TestApp;
  let client: Client;
  let customer: string;

  async function error(response: Response) {
    expect(response.headers.get("Content-Type")).toContain("application/json");
    return (await response.json()).error as { code: string; message: string; details?: unknown };
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    customer = (await client.signUp("customer", "c@body.example", "Body Buyer")).token;
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("a JSON body of more than 100 KB gets 413, with and without Content-Length", async () => {
    const big = JSON.stringify({ email: "a@b.example", password: "x".repeat(MAX_JSON_BODY_BYTES) });
    const headers = { "Content-Type": "application/json" };
    const streamed = await context.app.request(`${API}/auth/login`, {
      method: "POST",
      headers,
      body: big,
    });
    expect(streamed.status).toBe(413);
    expect((await error(streamed)).code).toBe("body_too_large");

    const sized = await context.app.request(`${API}/auth/login`, {
      method: "POST",
      headers: { ...headers, "Content-Length": String(big.length) },
      body: big,
    });
    expect(sized.status).toBe(413);

    const withToken = await client.send("POST", `${API}/projects`, customer, { notes: big });
    expect(withToken.status).toBe(413);
    // A body just under the limit is read (and then refused for its content).
    const fits = { email: "a@b.example", password: "x".repeat(MAX_JSON_BODY_BYTES - 200) };
    expect((await client.post(`${API}/auth/login`, fits)).status).toBe(422);
  });

  test("broken JSON gets the normal error shape with 400", async () => {
    for (const body of ["{", "", "not json"]) {
      const response = await context.app.request(`${API}/projects`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customer}`, "Content-Type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      const { code, message } = await error(response);
      expect(code).toBe("bad_request");
      expect(message).toBeString();
    }
  });

  test("control characters are refused in every text field", async () => {
    const project = { name: "Fair", startsOn: "2026-11-20", endsOn: "2026-11-21" };
    const item = { name: "Chair", category: "Stand", priceCents: 1 };
    const wrong: [string, object][] = [
      // A NUL makes PostgreSQL fail. It must never reach the database.
      [`${API}/projects`, { ...project, name: "a\u0000b" }],
      [`${API}/projects`, { ...project, notes: "a\u0000b" }],
      [`${API}/projects`, { ...project, venue: "line\nbreak" }],
      [`${API}/projects`, { ...project, city: "bell\u0007" }],
      [`${API}/items`, { ...item, name: "tab\there" }],
      [`${API}/items`, { ...item, description: "escape\u001b[31m" }],
      [`${API}/items`, { ...item, sku: "del\u007f" }],
    ];
    for (const [path, body] of wrong) {
      const response = await client.send("POST", path, customer, body);
      expect(response.status).toBe(422);
      expect((await error(response)).message).toEndWith("has a character that is not allowed.");
    }
    const profile = await client.send("PATCH", `${API}/company`, customer, { about: "x\u0000" });
    expect(profile.status).toBe(422);
    const name = await client.send("PATCH", `${API}/users/me`, customer, { name: "A\u0000B" });
    expect(name.status).toBe(422);
    const signUp = await client.post(`${API}/auth/register`, {
      name: "N",
      email: "n@body.example",
      password: `long-enough\u0000`,
      role: "customer",
      companyName: "N Co",
    });
    expect(signUp.status).toBe(422);

    // A text of more than one line keeps its line breaks and tabs.
    const notes = "Line one\r\nLine two\n\tindented";
    const made = await client.send("POST", `${API}/projects`, customer, { ...project, notes });
    expect(made.status).toBe(201);
    expect((await made.json()).notes).toBe(notes);
  });

  test("a validation error is a plain sentence with the label of the field", async () => {
    const item = { name: "Chair", category: "Stand", priceCents: 1 };
    const cases: [string, object, string, string][] = [
      [`${API}/items`, { ...item, priceCents: 3_000_000_000 }, "priceCents", "Price is too high."],
      [`${API}/items`, { ...item, priceCents: -1 }, "priceCents", "Price cannot be below 0."],
      [`${API}/items`, { ...item, priceCents: 1.5 }, "priceCents", "Price must be a whole number."],
      [`${API}/items`, { ...item, name: " " }, "name", "Name is required."],
      [`${API}/items`, { category: "Stand", priceCents: 1 }, "name", "Name is required."],
      [
        `${API}/items`,
        { ...item, name: "x".repeat(101) },
        "name",
        "Name is too long. Use up to 100 characters.",
      ],
      [`${API}/items`, { ...item, unit: "box" }, "unit", "Choose a unit."],
      [
        `${API}/projects`,
        { name: "Fair", startsOn: "20-11-2026", endsOn: "2026-11-21" },
        "startsOn",
        "Start date must be a date like 2026-11-20.",
      ],
      [
        `${API}/users/me/password`,
        { currentPassword: PASSWORD, newPassword: "short" },
        "newPassword",
        "New password is too short. Use at least 8 characters.",
      ],
    ];
    for (const [path, body, field, message] of cases) {
      const response = await client.send("POST", path, customer, body);
      expect(response.status).toBe(422);
      const found = await error(response);
      expect(found.code).toBe("validation_failed");
      // The first sentence is also the main message.
      expect(found.message).toBe(message);
      expect(found.details).toEqual([{ path: field, message }]);
    }
    const login = await client.post(`${API}/auth/login`, { email: "nobody", password: "x" });
    expect((await error(login)).message).toBe("Email is not valid.");
  });
});

describe("data safety", () => {
  let context: TestApp;
  let client: Client;

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("a profile save that is in flight does not undo the disable of the admin", async () => {
    const account = { name: "Root", email: "root@safe.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    const admin = (await client.login(account.email)).token;
    const bad = await client.signUp("supplier", "bad@safe.example", "Bad Supply");
    // The write of the owner waits, like a slow query, until the admin is done.
    const original = context.companies.updateProfile.bind(context.companies);
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    context.companies.updateProfile = async (id, fields) => {
      reached.resolve();
      await gate.promise;
      return original(id, fields);
    };

    const save = client.send("PATCH", `${API}/company`, bad.token, { about: "Still here" });
    await reached.promise;
    context.companies.updateProfile = original;
    const path = `${API}/companies/${bad.user.companyId}`;
    // SQLite runs one request at a time, so there the save must end first.
    if (context.sql.options.adapter === "sqlite") {
      gate.resolve();
    }
    const disabled = await client.send("PATCH", path, admin, { disabled: true });
    expect((await disabled.json()).disabledAt).not.toBeNull();
    gate.resolve();
    await save;

    const [row] = await context.sql`
      SELECT disabled_at, about FROM companies WHERE id = ${bad.user.companyId}
    `;
    expect(row.disabled_at).not.toBeNull();
    expect(row.about).toBe("Still here");
    expect((await client.login("bad@safe.example")).status).toBe(403);

    // A rename by the admin keeps it disabled. Disabling twice keeps the first date.
    const renamed = await client.send("PATCH", path, admin, {
      name: "Bad Supply 2",
      disabled: true,
    });
    expect(await renamed.json()).toMatchObject({
      name: "Bad Supply 2",
      disabledAt: row.disabled_at,
    });
    const enabled = await client.send("PATCH", path, admin, { disabled: false });
    expect((await enabled.json()).disabledAt).toBeNull();
  });

  test("a company can have at most 5000 items", async () => {
    const owner = await client.signUp("supplier", "full@safe.example", "Full Supply");
    const now = new Date().toISOString();
    const rows = [];
    for (let index = 0; index < MAX_COMPANY_ITEMS - 1; index++) {
      rows.push({
        id: crypto.randomUUID(),
        company_id: owner.user.companyId,
        name: `Bulk ${index}`,
        category: "Bulk",
        price_cents: 1,
        created_at: now,
      });
    }
    // A few inserts with many rows each. One insert cannot hold this many values.
    for (let start = 0; start < rows.length; start += 1000) {
      await context.sql`INSERT INTO items ${context.sql(rows.slice(start, start + 1000))}`;
    }
    const item = { name: "Number 5000", category: "Stand", priceCents: 1 };
    expect((await client.send("POST", `${API}/items`, owner.token, item)).status).toBe(201);

    const refused = await client.send("POST", `${API}/items`, owner.token, item);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("too_many_items");
    // Another company is not touched by it.
    const other = (await client.signUp("supplier", "room@safe.example", "Room Supply")).token;
    expect((await client.send("POST", `${API}/items`, other, item)).status).toBe(201);
  });

  test("the database checks foreign keys, on SQLite too", async () => {
    if (context.sql.options.adapter === "sqlite") {
      const [row] = await context.sql`PRAGMA foreign_keys`;
      expect(row.foreign_keys).toBe(1);
    }
    const insert = context.sql`
      INSERT INTO items (id, company_id, name, category, price_cents, created_at)
      VALUES (${crypto.randomUUID()}, 'no-such-company', 'Orphan', 'x', 1, 'now')
    `;
    expect(insert.execute()).rejects.toThrow();
  });

  test("the docs page loads a fixed version of its script, and is off in production", async () => {
    const page = await (await context.app.request("/docs")).text();
    expect(DOCS_SCRIPT_URL).toMatch(/@\d+\.\d+\.\d+$/);
    expect(page).toContain(DOCS_SCRIPT_URL);

    const production = await buildApp({ NODE_ENV: "production", DATABASE_URL: "postgres://h/db" });
    expect((await production.app.request("/docs")).status).toBe(404);
    await production.sql.close();
  });

  test("two servers that start at the same moment do not both migrate (PostgreSQL)", async () => {
    const url = Bun.env.TEST_DATABASE_URL;
    if (!url) {
      // SQLite has one writer and no second server.
      return;
    }
    const first = new SQL(url);
    await first`DROP SCHEMA public CASCADE`;
    await first`CREATE SCHEMA public`;
    const second = new SQL(url);

    const ran = await Promise.all([new Migrator(first).run(), new Migrator(second).run()]);

    // One of them ran every file. The other one waited and found nothing to do.
    const counts = [ran[0].length, ran[1].length].sort();
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(16);
    const [row] = await first`SELECT COUNT(*) AS total FROM migrations`;
    expect(Number(row.total)).toBe(counts[1] as number);
    await first.close();
    await second.close();
    // Put the schema back for the app of this file.
    await new Migrator(context.sql).run();
  });
});
