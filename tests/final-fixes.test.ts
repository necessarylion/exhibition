import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { network } from "../app/middleware/rate-limit.middleware";
import { TokenCleaner } from "../app/services/token-cleaner.service";
import { describeDatabase, type SeedRequest, seedRefusal } from "../database/seeder";
import { API, World } from "./support/world";

/** The fixes of the third review. Each `describe` names its finding. */
let world: World;
let admin: string;

beforeAll(async () => {
  world = await World.create();
  admin = await world.admin();
});

afterAll(async () => {
  await world.close();
});

async function actAs(companyId: string): Promise<string> {
  const response = await world.client.send(
    "POST",
    `${API}/companies/${companyId}/impersonate`,
    admin,
  );
  expect(response.status).toBe(200);
  return (await response.json()).token;
}

async function orderRows() {
  return world.context.sql`
    SELECT orders.status, orders.cancelled_by FROM orders
    JOIN companies ON companies.id = orders.supplier_company_id
    WHERE companies.name = ${"Gone Supply"}
  `;
}

describe("L1: disable and send at the same moment", () => {
  test("a send that is in progress finishes first, then its order is cancelled", async () => {
    const supplier = await world.supplier("Gone Supply");
    const item = await world.item(supplier.token);
    const buyer = await world.customer("Late Buyer");
    const projectId = await world.project(buyer.token);
    await world.addLine(buyer.token, projectId, item);

    // The send is held just before its transaction ends: the order is made, not saved yet.
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const service = world.context.notificationService;
    const real = service.notifyCompany.bind(service);
    service.notifyCompany = async (companyId, text, link, db) => {
      if (text.includes("sent order")) {
        reached.resolve();
        await gate.promise;
      }
      return real(companyId, text, link, db);
    };
    try {
      const sending = world.client.sendProject(projectId, buyer.token);
      await reached.promise;
      // The disable must wait for the send. Before the fix it did not see the new order.
      const disabling = world.client.send(
        "PATCH",
        `${API}/companies/${supplier.user.companyId}`,
        admin,
        { disabled: true },
      );
      await Bun.sleep(200);
      gate.resolve();
      expect((await sending).status).toBe(200);
      expect((await disabling).status).toBe(200);
    } finally {
      service.notifyCompany = real;
    }
    const rows = await orderRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("cancelled");
    expect(rows[0].cancelled_by).toBe("admin");
  }, 30_000);

  test("a send checks again after the lock: a company disabled a moment ago gets no order", async () => {
    const supplier = await world.supplier("Closing Supply");
    const item = await world.item(supplier.token);
    const buyer = await world.customer("Quick Buyer");
    const projectId = await world.project(buyer.token);
    await world.addLine(buyer.token, projectId, item);

    // The send is held after its catalog check and before it locks the companies.
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const companies = world.context.companies;
    const real = companies.lockEnabled.bind(companies);
    companies.lockEnabled = async (ids, db) => {
      reached.resolve();
      await gate.promise;
      return real(ids, db);
    };
    try {
      const sending = world.client.sendProject(projectId, buyer.token);
      await reached.promise;
      await companies.disable(supplier.user.companyId, new Date().toISOString());
      gate.resolve();
      const sent = await sending;
      expect(sent.status).toBe(409);
      expect((await sent.json()).error.code).toBe("item_unavailable");
    } finally {
      companies.lockEnabled = real;
    }
    const [row] = await world.context.sql`
      SELECT COUNT(*) AS total FROM orders WHERE project_id = ${projectId}
    `;
    expect(Number(row.total)).toBe(0);
  }, 30_000);
});

describe("L2: what an acting admin does is written down", () => {
  test("every change with an acting token adds a row, and the admin can read the log", async () => {
    const buyer = await world.customer("Watched Buyer");
    const acting = await actAs(buyer.user.companyId);

    // A change: one row.
    const made = await world.client.send("POST", `${API}/projects`, acting, {
      name: "Made by the admin",
      startsOn: "2027-05-01",
      endsOn: "2027-05-02",
    });
    expect(made.status).toBe(201);
    const projectId = (await made.json()).id;
    // A read: no row. A change that is refused: no row.
    expect((await world.get("/projects", acting)).status).toBe(200);
    const refused = await world.client.send("PATCH", `${API}/users/me`, acting, { name: "X" });
    expect(refused.status).toBe(403);
    const cancelled = await world.client.send(
      "POST",
      `${API}/projects/${projectId}/cancel`,
      acting,
    );
    expect(cancelled.status).toBe(200);
    // The owner of the company works too. That is not the admin, so no row.
    expect((await world.project(buyer.token)).length).toBe(36);
    const stopped = await world.client.send("POST", `${API}/auth/stop-impersonating`, acting);
    expect(stopped.status).toBe(204);

    const response = await world.get("/admin-actions", admin);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Total-Count")).toBe("4");
    const rows = await response.json();
    const actions: string[] = [];
    for (const row of rows) {
      actions.push(row.action);
      expect(row.adminName).toBe("Root Admin");
      expect(row.companyName).toBe("Watched Buyer");
    }
    // The newest first.
    expect(actions).toEqual([
      "POST /auth/stop-impersonating",
      `POST /projects/${projectId}/cancel`,
      "POST /projects",
      "impersonate",
    ]);
    // The row keeps the ids of the admin, the company and the user.
    const [stored] = await world.context.sql`
      SELECT admin_user_id, company_id, user_id FROM admin_actions WHERE action = 'POST /projects'
    `;
    expect(stored.company_id).toBe(buyer.user.companyId);
    expect(stored.user_id).toBe(buyer.user.id);
    expect(stored.admin_user_id).not.toBe(buyer.user.id);

    // Paging.
    const one = await world.get("/admin-actions?limit=1&offset=1", admin);
    expect((await one.json())[0].action).toBe(`POST /projects/${projectId}/cancel`);
  });

  test("only an admin reads the log", async () => {
    const buyer = await world.customer("Curious Buyer");
    expect((await world.get("/admin-actions", buyer.token)).status).toBe(403);
    // An acting token has the role of the customer.
    const acting = await actAs(buyer.user.companyId);
    expect((await world.get("/admin-actions", acting)).status).toBe(403);
    expect((await world.context.app.request(`${API}/admin-actions`)).status).toBe(401);
  });

  test("the daily cleaner deletes the rows that are older than one year", async () => {
    const { sql, clock } = world.context;
    const [before] = await sql`SELECT COUNT(*) AS total FROM admin_actions`;
    const old = new Date(clock.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
    const young = new Date(clock.now() - 364 * 24 * 60 * 60 * 1000).toISOString();
    await sql`UPDATE admin_actions SET created_at = ${old} WHERE action = 'POST /projects'`;
    await sql`UPDATE admin_actions SET created_at = ${young} WHERE action = 'POST /auth/stop-impersonating'`;
    await new TokenCleaner(
      world.context.tokens,
      world.context.notifications,
      clock,
      world.context.adminActions,
    ).run();
    const [after] = await sql`SELECT COUNT(*) AS total FROM admin_actions`;
    expect(Number(after.total)).toBe(Number(before.total) - 1);
    const gone = await sql`SELECT id FROM admin_actions WHERE action = 'POST /projects'`;
    expect(gone.length).toBe(0);
  });
});

describe("L4: a client address with a port", () => {
  test("the port is not part of the client", () => {
    expect(network("203.0.113.9:51000")).toBe("203.0.113.9");
    expect(network("203.0.113.9:51001")).toBe("203.0.113.9");
    expect(network("[2001:db8::9]:443")).toBe("2001:db8:0:0::/64");
    expect(network("[2001:db8::9]")).toBe(network("2001:db8::9"));
    // Without a port nothing changes.
    expect(network("203.0.113.9")).toBe("203.0.113.9");
    expect(network("2001:db8::9")).toBe("2001:db8:0:0::/64");
    expect(network("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
});

// PostgreSQL runs the requests side by side, so it has no queue to hold.
describe.skipIf(Boolean(Bun.env.TEST_DATABASE_URL))("L5: SQLite, one request at a time", () => {
  test("a body that comes slowly does not hold the other requests", async () => {
    const buyer = await world.customer("Queue Buyer");
    let push: ReadableStreamDefaultController<Uint8Array> | undefined;
    const slow = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
        controller.enqueue(new TextEncoder().encode('{"email":"a@b.example",'));
      },
    });
    const first = world.context.app.request(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "38" },
      body: slow,
      // @ts-expect-error Bun needs this for a stream body.
      duplex: "half",
    });
    await Bun.sleep(50);
    async function ask() {
      return (await world.get("/users/me", buyer.token)).status;
    }
    const second = await Promise.race([ask(), Bun.sleep(1500).then(() => "still waiting")]);
    expect(second).toBe(200);
    push?.enqueue(new TextEncoder().encode('"password":"x"}'));
    push?.close();
    // The slow request still gets its normal answer: the login is wrong.
    expect((await first).status).toBe(401);
  });

  test("a request that is stuck gets a 503 and gives its turn back", async () => {
    const stuck = await world.customer("Stuck Buyer");
    const other = await world.customer("Patient Buyer");
    const { authService, transactions } = world.context;
    const real = authService.authenticate.bind(authService);
    const gate = Promise.withResolvers<void>();
    authService.authenticate = async (token) => {
      if (token === stuck.token) {
        await gate.promise;
      }
      return real(token);
    };
    transactions.requestTimeoutMs = 100;
    try {
      const first = world.get("/users/me", stuck.token);
      const second = world.get("/users/me", other.token);
      const answer = await first;
      expect(answer.status).toBe(503);
      expect((await answer.json()).error.code).toBe("busy");
      expect((await second).status).toBe(200);
    } finally {
      gate.resolve();
      transactions.requestTimeoutMs = 30_000;
      authService.authenticate = real;
    }
  });
});

describe("L6: a date far away", () => {
  test("a date must be between 2000 and 2100", async () => {
    const buyer = await world.customer("Dated Buyer");
    async function create(startsOn: string, endsOn: string) {
      const body = { name: "Far Fair", startsOn, endsOn };
      return world.client.send("POST", `${API}/projects`, buyer.token, body);
    }
    const far = await create("2027-01-01", "9999-12-31");
    expect(far.status).toBe(422);
    expect((await far.json()).error.message).toBe(
      "End date must be between 2000-01-01 and 2100-12-31.",
    );
    expect((await create("2101-01-01", "2101-01-01")).status).toBe(422);
    const early = await create("1999-12-31", "2027-01-01");
    expect((await early.json()).error.message).toBe(
      "Start date must be between 2000-01-01 and 2100-12-31.",
    );
    // The last day that is allowed.
    expect((await create("2100-12-31", "2100-12-31")).status).toBe(201);
  });
});

describe("M2: the seeder guard", () => {
  const sqliteEmpty: SeedRequest = {
    nodeEnv: undefined,
    sqlite: true,
    fresh: false,
    confirmed: false,
    companies: 0,
  };

  test("it never runs with NODE_ENV=production, whatever the flags are", () => {
    const all = { ...sqliteEmpty, nodeEnv: "production", fresh: true, confirmed: true };
    expect(seedRefusal(all)).toContain("NODE_ENV=production");
    expect(seedRefusal({ ...sqliteEmpty, nodeEnv: "production" })).toContain("NODE_ENV");
  });

  test("SQLite: an empty database is filled, and --fresh needs no other flag", () => {
    expect(seedRefusal(sqliteEmpty)).toBeNull();
    expect(seedRefusal({ ...sqliteEmpty, nodeEnv: "development" })).toBeNull();
    expect(seedRefusal({ ...sqliteEmpty, fresh: true, companies: 10 })).toBeNull();
  });

  test("it never seeds into a database that has companies without --fresh", () => {
    expect(seedRefusal({ ...sqliteEmpty, companies: 1 })).toContain("already has companies");
    const postgres = { ...sqliteEmpty, sqlite: false, companies: 1 };
    expect(seedRefusal(postgres)).toContain("already has companies");
    // The flag alone deletes nothing and allows nothing.
    expect(seedRefusal({ ...postgres, confirmed: true })).toContain("already has companies");
  });

  test("PostgreSQL: --fresh needs --i-know-this-deletes-data, also on an empty database", () => {
    const postgres = { ...sqliteEmpty, sqlite: false };
    // The first seed of an empty database needs no flag.
    expect(seedRefusal(postgres)).toBeNull();
    expect(seedRefusal({ ...postgres, fresh: true })).toContain("--i-know-this-deletes-data");
    expect(seedRefusal({ ...postgres, fresh: true, companies: 5 })).toContain(
      "Nothing was changed",
    );
    expect(seedRefusal({ ...postgres, fresh: true, confirmed: true, companies: 5 })).toBeNull();
  });

  test("the host and the name of the database are printed without the password", () => {
    expect(describeDatabase("postgres://app:secret@db.example.com:5432/exhibition")).toEqual({
      host: "db.example.com:5432",
      name: "exhibition",
    });
    expect(describeDatabase("sqlite://database/dev.sqlite")).toEqual({
      host: "this computer",
      name: "database/dev.sqlite",
    });
  });

  test("the script: --fresh says what it deletes, and production is refused", async () => {
    const dir = world.context.config.storageDir;
    const env = {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: `sqlite://${dir}/seed.sqlite`,
      STORAGE_DIR: `${dir}/seed-storage`,
    };
    async function seed(args: string[], nodeEnv = "development") {
      const run = Bun.spawn(["bun", "database/seed.ts", ...args], {
        env: { ...env, NODE_ENV: nodeEnv },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output =
        (await new Response(run.stdout).text()) + (await new Response(run.stderr).text());
      return { code: await run.exited, output };
    }
    expect((await seed([])).code).toBe(0);
    const again = await seed([]);
    expect(again.code).toBe(1);
    expect(again.output).toContain("already has companies");
    const fresh = await seed(["--fresh"]);
    expect(fresh.code).toBe(0);
    expect(fresh.output).toContain(`seed.sqlite" on this computer: 10 companies`);
    const production = await seed(["--fresh", "--i-know-this-deletes-data"], "production");
    expect(production.code).toBe(1);
    expect(production.output).toContain("NODE_ENV=production");
  }, 60_000);
});
