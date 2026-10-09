import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PASSWORD } from "./support/build-app";
import { type Account, API, World } from "./support/world";

/** An admin acts as a customer (D14). */
describe("an admin acts as a customer", () => {
  let world: World;
  let admin: string;
  let second: string;
  let adminId: string;
  let money: Account;
  let other: Account;
  let supplier: Account;
  let item: string;

  /** Starts to act as a company. Returns the answer. */
  function start(companyId: string, token = admin) {
    return world.client.send("POST", `${API}/companies/${companyId}/impersonate`, token);
  }

  async function acting(companyId = money.user.companyId): Promise<string> {
    const response = await start(companyId);
    expect(response.status).toBe(200);
    return (await response.json()).token;
  }

  beforeAll(async () => {
    world = await World.create();
    admin = await world.admin("mya@acting.example", "Mya Thandar");
    adminId = (await world.json("/users/me", admin)).id;
    const two = { name: "Second Admin", email: "two@acting.example", password: PASSWORD };
    expect((await world.client.send("POST", `${API}/users`, admin, two)).status).toBe(201);
    second = (await world.client.login(two.email)).token;
    money = await world.customer("True Money");
    other = await world.customer("Other Buyer");
    supplier = await world.supplier("Acting Supply");
    item = await world.item(supplier.token, { priceCents: 5000 });
  });

  afterAll(async () => {
    await world.close();
  });

  test("only a platform admin can start, and only for a customer company that is on", async () => {
    const path = `${API}/companies/${money.user.companyId}/impersonate`;
    expect((await world.context.app.request(path, { method: "POST" })).status).toBe(401);
    for (const token of [other.token, supplier.token, money.token]) {
      const refused = await start(money.user.companyId, token);
      expect(refused.status).toBe(403);
      expect((await refused.json()).error.code).toBe("forbidden");
    }
    const asSupplier = await start(supplier.user.companyId);
    expect(asSupplier.status).toBe(409);
    expect((await asSupplier.json()).error.code).toBe("not_a_customer");
    const adminCompany = (await world.json("/users/me", admin)).companyId;
    expect((await start(adminCompany)).status).toBe(404);
    expect((await start(crypto.randomUUID())).status).toBe(404);
    expect((await start("not-an-id")).status).toBe(422);

    const off = await world.customer("Off Buyer");
    const offPath = `${API}/companies/${off.user.companyId}`;
    await world.client.send("PATCH", offPath, admin, { disabled: true });
    const disabled = await start(off.user.companyId);
    expect(disabled.status).toBe(409);
    expect((await disabled.json()).error.code).toBe("company_disabled");
    // None of these wrote a token, a log row or a notification.
    const [tokens] = await world.context
      .sql`SELECT COUNT(*) AS total FROM access_tokens WHERE impersonator_id IS NOT NULL`;
    const [actions] = await world.context.sql`SELECT COUNT(*) AS total FROM admin_actions`;
    expect(Number(tokens.total)).toBe(0);
    expect(Number(actions.total)).toBe(0);
  });

  test("the start gives a 2 hour token for the owner, a log row and a notification", async () => {
    const mate = { name: "Mate", email: "mate@acting.example", password: PASSWORD };
    expect((await world.client.send("POST", `${API}/users`, money.token, mate)).status).toBe(201);
    const mateToken = (await world.client.login(mate.email)).token;

    const response = await start(money.user.companyId);
    expect(response.status).toBe(200);
    const auth = await response.json();
    // The token is for the OWNER, also when the company has more users.
    expect(auth.user).toMatchObject({
      id: money.user.id,
      companyId: money.user.companyId,
      role: "customer",
      isOwner: true,
      actingAdmin: { id: adminId, name: "Mya Thandar" },
    });
    const lasts = Date.parse(auth.expiresAt) - Date.now();
    expect(lasts).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
    expect(lasts).toBeLessThanOrEqual(2 * 60 * 60 * 1000);

    const me = await world.json("/users/me", auth.token);
    expect(me).toMatchObject({
      id: money.user.id,
      role: "customer",
      actingAdmin: { id: adminId, name: "Mya Thandar" },
    });
    // A normal login of the same user is not marked.
    expect((await world.json("/users/me", money.token)).actingAdmin).toBeNull();
    expect((await world.json("/users/me", admin)).actingAdmin).toBeNull();

    const rows = await world.context.sql`SELECT * FROM admin_actions`;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      admin_user_id: adminId,
      admin_name: "Mya Thandar",
      company_id: money.user.companyId,
      user_id: money.user.id,
      action: "impersonate",
    });
    const text = "Mya Thandar (platform admin) worked in your account.";
    expect(await world.notes(money.token)).toContain(text);
    expect(await world.notes(mateToken)).toContain(text);
    expect(await world.notes(other.token)).not.toContain(text);
    await world.client.send("POST", `${API}/auth/stop-impersonating`, auth.token);
  });

  test("the acting token cannot reach an admin endpoint or another company", async () => {
    const token = await acting();
    const companyId = other.user.companyId;
    const adminCalls: [string, string, object?][] = [
      ["GET", "/companies?type=customer"],
      ["GET", "/companies?type=supplier"],
      [
        "POST",
        "/companies",
        {
          name: "X",
          email: "x@x.example",
          password: PASSWORD,
          role: "customer",
          companyName: "X Co",
        },
      ],
      ["PATCH", `/companies/${companyId}`, { disabled: true }],
      ["PATCH", `/companies/${money.user.companyId}`, { name: "Renamed" }],
      ["POST", `/companies/${supplier.user.companyId}/approve`],
      ["GET", "/organizations"],
      ["POST", "/organizations", { name: "My Group" }],
      ["GET", "/items"],
      ["GET", `/users?companyId=${companyId}`],
      ["POST", `/users`, { name: "Y", email: "y@y.example", password: PASSWORD, companyId }],
    ];
    for (const [method, path, body] of adminCalls) {
      const response = await world.client.send(method, `${API}${path}`, token, body);
      expect([403, 404]).toContain(response.status);
    }
    // Acting again, for the same or for another company, has its own message.
    for (const id of [companyId, money.user.companyId]) {
      const again = await start(id, token);
      expect(again.status).toBe(403);
      expect((await again.json()).error.code).toBe("not_while_acting");
    }
    // The lists are those of the customer, not the "everything" lists of an admin.
    const foreign = await world.project(other.token);
    const mine = await world.json("/projects", token);
    expect(mine.every((row: { companyId: string }) => row.companyId === money.user.companyId)).toBe(
      true,
    );
    expect((await world.get(`/projects/${foreign}`, token)).status).toBe(404);
    const foreignOrder = await world.order(other.token, item);
    expect((await world.get(`/orders/${foreignOrder.orderId}`, token)).status).toBe(404);
    // An admin cancels any order with a reason. The acting token is a customer: it cannot.
    const cancel = await world.act(token, foreignOrder.orderId, "cancel", { reason: "No." });
    expect(cancel.status).toBe(404);
    expect((await world.json("/dashboard", token)).role).toBe("customer");
    // Nothing above changed a company.
    const companies = await world.json("/companies?type=customer", admin);
    expect(companies.find((row: { id: string }) => row.id === companyId).disabledAt).toBeNull();
    expect(companies.some((row: { name: string }) => row.name === "Renamed")).toBe(false);
    await world.client.send("POST", `${API}/auth/stop-impersonating`, token);
  });

  test("what the admin makes while acting says so, and nobody can fake that mark", async () => {
    const token = await acting();
    const projectId = await world.project(token, "2027-04-01", "2027-04-02");
    expect((await world.addLine(token, projectId, item, 2)).status).toBe(201);
    const sent = await world.client.sendProject(projectId, token);
    expect(sent.status).toBe(200);
    const detail = await sent.json();
    expect(detail.project).toMatchObject({
      companyId: money.user.companyId,
      createdBy: money.user.id,
      createdByAdminName: "Mya Thandar",
    });
    expect(detail.orders[0]).toMatchObject({
      createdByAdminName: "Mya Thandar",
      status: "pending",
    });
    const [project] = await world.context
      .sql`SELECT created_by_admin_id FROM projects WHERE id = ${projectId}`;
    const [order] = await world.context
      .sql`SELECT created_by_admin_id FROM orders WHERE id = ${detail.orders[0].id}`;
    expect(project.created_by_admin_id).toBe(adminId);
    expect(order.created_by_admin_id).toBe(adminId);
    // The customer and the supplier see who made it. The supplier got the order as usual.
    const forOwner = await world.json(`/projects/${projectId}`, money.token);
    expect(forOwner.project.createdByAdminName).toBe("Mya Thandar");
    const forSupplier = await world.json(`/orders/${detail.orders[0].id}`, supplier.token);
    expect(forSupplier.createdByAdminName).toBe("Mya Thandar");
    await world.client.send("POST", `${API}/auth/stop-impersonating`, token);

    // A customer sends the names of the mark in the body: they are dropped.
    const forged = await world.client.send("POST", `${API}/projects`, money.token, {
      name: "Forged",
      startsOn: "2027-04-10",
      endsOn: "2027-04-11",
      createdByAdminId: adminId,
      createdByAdminName: "Mya Thandar",
      created_by_admin_id: adminId,
      actingAdmin: { id: adminId, name: "Mya Thandar" },
      impersonatorId: adminId,
    });
    expect(forged.status).toBe(201);
    const made = await forged.json();
    expect(made.createdByAdminName).toBeNull();
    const [row] = await world.context
      .sql`SELECT created_by_admin_id, created_by_admin_name FROM projects WHERE id = ${made.id}`;
    expect(row).toMatchObject({ created_by_admin_id: null, created_by_admin_name: null });
    // An order that the customer sends alone has no mark.
    const own = await world.order(money.token, item);
    expect((await world.json(`/orders/${own.orderId}`, money.token)).createdByAdminName).toBeNull();
    // No login token is ever marked.
    const marked = await world.context
      .sql`SELECT user_id FROM access_tokens WHERE impersonator_id IS NOT NULL`;
    expect(marked.length).toBe(0);
  });

  test("while acting, the admin cannot change who can log in to the account", async () => {
    const token = await acting();
    const mate = { name: "New Mate", email: "newmate@acting.example", password: PASSWORD };
    const [someone] = await world.json("/users", money.token);
    const blocked: [string, string, object?][] = [
      ["PATCH", "/users/me", { name: "Hacked" }],
      [
        "POST",
        "/users/me/password",
        { currentPassword: PASSWORD, newPassword: "a-new-password-1" },
      ],
      ["POST", "/auth/logout-all"],
      ["POST", "/users", mate],
      ["DELETE", `/users/${someone.id}`],
      ["POST", `/users/${someone.id}/password`, { newPassword: "a-new-password-1" }],
    ];
    for (const [method, path, body] of blocked) {
      const response = await world.client.send(method, `${API}${path}`, token, body);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("not_while_acting");
    }
    // Nothing changed: the name, the password, the users and the sessions.
    expect((await world.json("/users/me", money.token)).name).toBe("True Money");
    expect((await world.client.login(world.email("True Money"))).status).toBe(200);
    const users = await world.json("/users", money.token);
    expect(users.some((user: { email: string }) => user.email === mate.email)).toBe(false);
    expect((await world.get("/users/me", money.token)).status).toBe(200);
    // The rest of the account works: the company page, the catalog, the notifications.
    for (const path of ["/company", "/items/catalog", "/notifications", "/items/mine", "/users"]) {
      expect((await world.get(path, token)).status).toBe(200);
    }
    const about = { about: "Changed by the platform for the customer." };
    expect((await world.client.send("PATCH", `${API}/company`, token, about)).status).toBe(200);
    await world.client.send("POST", `${API}/auth/stop-impersonating`, token);
  });

  test("stop ends the acting token and nothing else", async () => {
    const token = await acting();
    const stop = `${API}/auth/stop-impersonating`;
    expect((await world.client.send("POST", stop, token)).status).toBe(204);
    expect((await world.get("/users/me", token)).status).toBe(401);
    // A second stop finds a dead token. The sessions of the admin and the customer live on.
    expect((await world.client.send("POST", stop, token)).status).toBe(401);
    expect((await world.get("/users/me", admin)).status).toBe(200);
    expect((await world.get("/users/me", money.token)).status).toBe(200);
    // A normal token is no acting session. It is refused and keeps working.
    for (const normal of [admin, money.token]) {
      const refused = await world.client.send("POST", stop, normal);
      expect(refused.status).toBe(409);
      expect((await world.get("/users/me", normal)).status).toBe(200);
    }
    expect((await world.context.app.request(stop, { method: "POST" })).status).toBe(401);
  });

  test("a plain log out of the acting token ends only that token", async () => {
    const token = await acting();
    expect((await world.client.send("POST", `${API}/auth/logout`, token)).status).toBe(204);
    expect((await world.get("/users/me", token)).status).toBe(401);
    expect((await world.get("/users/me", admin)).status).toBe(200);
    expect((await world.get("/users/me", money.token)).status).toBe(200);
  });

  test("the acting token ends after 2 hours", async () => {
    const token = await acting();
    const soon = new Date(Date.now() + 60_000).toISOString();
    await world.context
      .sql`UPDATE access_tokens SET expires_at = ${soon} WHERE impersonator_id IS NOT NULL`;
    expect((await world.get("/users/me", token)).status).toBe(200);
    const past = new Date(Date.now() - 1000).toISOString();
    await world.context
      .sql`UPDATE access_tokens SET expires_at = ${past} WHERE impersonator_id IS NOT NULL`;
    expect((await world.get("/users/me", token)).status).toBe(401);
    const left = await world.context
      .sql`SELECT id FROM access_tokens WHERE impersonator_id IS NOT NULL`;
    expect(left.length).toBe(0);
  });

  test("the acting token dies with the company, the admin and the sessions around it", async () => {
    // The customer logs out everywhere: the admin is out of the account too.
    const fresh = await world.customer("Fresh Buyer");
    let token = await acting(fresh.user.companyId);
    expect((await world.client.send("POST", `${API}/auth/logout-all`, fresh.token)).status).toBe(
      204,
    );
    expect((await world.get("/users/me", token)).status).toBe(401);

    // The customer changes the password: the same.
    const again = (await world.client.login(world.email("Fresh Buyer"))).token;
    token = await acting(fresh.user.companyId);
    const change = { currentPassword: PASSWORD, newPassword: "a-new-password-1" };
    expect(
      (await world.client.send("POST", `${API}/users/me/password`, again, change)).status,
    ).toBe(204);
    expect((await world.get("/users/me", token)).status).toBe(401);
    expect((await world.get("/users/me", again)).status).toBe(200);

    // The company is disabled while the admin acts.
    token = await acting(fresh.user.companyId);
    const path = `${API}/companies/${fresh.user.companyId}`;
    await world.client.send("PATCH", path, admin, { disabled: true });
    expect((await world.get("/users/me", token)).status).toBe(401);
    await world.client.send("PATCH", path, admin, { disabled: false });
    // The company is on again. The old acting token stays dead: the admin starts again.
    expect((await world.get("/users/me", token)).status).toBe(401);
    expect((await world.get("/users/me", again)).status).toBe(200);

    // The admin logs out: every acting session of that admin ends. Others stay.
    const mine = await (await start(fresh.user.companyId, second)).json();
    const theirs = await acting(fresh.user.companyId);
    expect((await world.client.send("POST", `${API}/auth/logout`, second)).status).toBe(204);
    expect((await world.get("/users/me", mine.token)).status).toBe(401);
    expect((await world.get("/users/me", theirs)).status).toBe(200);

    // The admin user is removed: the acting token is gone with them.
    second = (await world.client.login("two@acting.example")).token;
    const secondId = (await world.json("/users/me", second)).id;
    const held = (await (await start(fresh.user.companyId, second)).json()).token;
    expect((await world.get("/users/me", held)).status).toBe(200);
    expect((await world.client.send("DELETE", `${API}/users/${secondId}`, admin)).status).toBe(204);
    expect((await world.get("/users/me", held)).status).toBe(401);
    expect((await world.get("/users/me", theirs)).status).toBe(200);
    // The log still says who it was.
    const log = await world.context
      .sql`SELECT admin_name, admin_user_id FROM admin_actions WHERE admin_name = 'Second Admin'`;
    expect(log.length).toBe(2);
    expect(log[0].admin_user_id).toBeNull();
    await world.client.send("POST", `${API}/auth/stop-impersonating`, theirs);
  });

  test("a token that points to somebody who is no admin any more is refused", async () => {
    const token = await acting();
    // Not possible through the API. The check must hold if the data ever says so.
    await world.context.sql`
      UPDATE access_tokens SET impersonator_id = ${other.user.id} WHERE impersonator_id IS NOT NULL
    `;
    expect((await world.get("/users/me", token)).status).toBe(401);
    const left = await world.context
      .sql`SELECT id FROM access_tokens WHERE impersonator_id IS NOT NULL`;
    expect(left.length).toBe(0);
  });
});
