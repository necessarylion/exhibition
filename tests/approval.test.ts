import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const API = "/api/v1";

/** A supplier that signs up by itself waits for an admin. Company names are unique. */
describe("supplier approval and company names", () => {
  let context: TestApp;
  let client: Client;
  let admin: string;
  let customer: string;
  let waiting: string;
  let waitingId: string;
  let itemId: string;

  function register(role: string, email: string, companyName: string) {
    const body = { name: "Owner", email, password: PASSWORD, role, companyName };
    return client.post(`${API}/auth/register`, body);
  }

  async function code(response: Response) {
    return (await response.json()).error.code as string;
  }

  async function catalogIds() {
    const items = await client.json(`${API}/items/catalog?limit=200`, customer);
    return items.map((item: { id: string }) => item.id);
  }

  async function suppliers() {
    return client.json(`${API}/companies?type=supplier`, admin) as Promise<
      { id: string; name: string; approvedAt: string | null }[]
    >;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    const account = { name: "Root", email: "root@approve.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    admin = (await client.login(account.email)).token;
    customer = (await client.signUp("customer", "c@approve.example", "Approve Buyer")).token;
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("who is approved at the start: everyone but a supplier that signs up by itself", async () => {
    const signedUp = await register("supplier", "wait@approve.example", "Expo Furniture");
    expect(signedUp.status).toBe(201);
    const auth = await signedUp.json();
    waiting = auth.token;
    waitingId = auth.user.companyId;
    expect(auth.user.companyApproved).toBe(false);
    expect((await client.json(`${API}/users/me`, waiting)).companyApproved).toBe(false);
    expect((await client.json(`${API}/company`, waiting)).approvedAt).toBeNull();

    // A customer, the admin company and a supplier that an admin creates are approved.
    expect((await client.json(`${API}/users/me`, customer)).companyApproved).toBe(true);
    expect((await client.json(`${API}/users/me`, admin)).companyApproved).toBe(true);
    const made = await client.send("POST", `${API}/companies`, admin, {
      name: "Made",
      email: "made@approve.example",
      password: PASSWORD,
      role: "supplier",
      companyName: "Made By Admin",
    });
    expect((await made.json()).approvedAt).not.toBeNull();

    // The waiting one comes first in the list of the admin.
    expect(
      (await suppliers()).map((company) => [company.name, company.approvedAt !== null]),
    ).toEqual([
      ["Expo Furniture", false],
      ["Made By Admin", true],
    ]);
    expect((await client.json(`${API}/dashboard`, admin)).suppliersWaiting).toBe(1);
  });

  test("a waiting supplier works on its items, but they are in no catalog and cannot be added", async () => {
    const item = { name: "Waiting chair", category: "Furniture", priceCents: 900 };
    const created = await client.send("POST", `${API}/items`, waiting, item);
    expect(created.status).toBe(201);
    itemId = (await created.json()).id;
    expect((await client.json(`${API}/items/mine`, waiting)).length).toBe(1);
    expect((await client.send("GET", `${API}/dashboard`, waiting)).status).toBe(200);

    expect(await catalogIds()).not.toContain(itemId);
    expect((await client.send("GET", `${API}/items/${itemId}`, customer)).status).toBe(404);
    const project = { name: "Fair", startsOn: "2026-11-20", endsOn: "2026-11-23" };
    const projectId = (
      await (await client.send("POST", `${API}/projects`, customer, project)).json()
    ).id;
    const add = await client.send("POST", `${API}/projects/${projectId}/lines`, customer, {
      itemId,
      quantity: 1,
    });
    expect(add.status).toBe(404);
    // The admin still sees the item in the list of all items.
    const all = await client.json(`${API}/items?limit=200`, admin);
    expect(all.map((row: { id: string }) => row.id)).toContain(itemId);
  });

  test("a line of a supplier that is not approved cannot be sent, and it cannot accept", async () => {
    // This cannot happen through the API. The rows are written by hand to test the guards.
    const sql = context.sql;
    const project = { name: "Guard Fair", startsOn: "2026-12-01", endsOn: "2026-12-02" };
    const projectId = (
      await (await client.send("POST", `${API}/projects`, customer, project)).json()
    ).id as string;
    await sql`
      INSERT INTO project_lines (id, project_id, item_id, quantity, created_at, position)
      VALUES (${crypto.randomUUID()}, ${projectId}, ${itemId}, 1, '2026-09-01T00:00:00.000Z', 1)
    `;
    const sent = await client.sendProject(projectId, customer);
    expect(sent.status).toBe(409);
    expect(await code(sent)).toBe("item_unavailable");
    expect(await client.json(`${API}/orders`, waiting)).toEqual([]);

    const customerId = (await client.json(`${API}/company`, customer)).id as string;
    const orderId = crypto.randomUUID();
    await sql`
      INSERT INTO orders (id, number, project_id, customer_company_id, supplier_company_id,
        status, total_cents, created_at, project_name, starts_on, ends_on)
      VALUES (${orderId}, 'ORD-GUARD', ${projectId}, ${customerId}, ${waitingId}, 'pending', 900,
        '2026-09-01T00:00:00.000Z', 'Guard Fair', '2026-12-01', '2026-12-02')
    `;
    const accept = await client.send("POST", `${API}/orders/${orderId}/accept`, waiting);
    expect(accept.status).toBe(403);
    expect(await code(accept)).toBe("not_approved");
    expect((await client.json(`${API}/orders/${orderId}`, waiting)).status).toBe("pending");
    await sql`DELETE FROM orders WHERE id = ${orderId}`;
    await sql`DELETE FROM project_lines WHERE project_id = ${projectId}`;
  });

  test("only an admin approves, and then the items are in the catalog", async () => {
    const path = `${API}/companies/${waitingId}/approve`;
    expect((await client.send("POST", path, waiting)).status).toBe(403);
    expect((await client.send("POST", path, customer)).status).toBe(403);
    expect((await context.app.request(path, { method: "POST" })).status).toBe(401);
    expect(await catalogIds()).not.toContain(itemId);
    const unknown = `${API}/companies/${crypto.randomUUID()}/approve`;
    expect((await client.send("POST", unknown, admin)).status).toBe(404);

    const approved = await client.send("POST", path, admin);
    expect(approved.status).toBe(200);
    const first = (await approved.json()).approvedAt as string;
    expect(first).not.toBeNull();
    expect(await catalogIds()).toContain(itemId);
    expect((await client.send("GET", `${API}/items/${itemId}`, customer)).status).toBe(200);
    expect((await client.json(`${API}/users/me`, waiting)).companyApproved).toBe(true);
    expect((await client.json(`${API}/dashboard`, admin)).suppliersWaiting).toBe(0);

    // Approving again keeps the first date and tells the supplier only once.
    expect((await (await client.send("POST", path, admin)).json()).approvedAt).toBe(first);
    const told = await client.json(`${API}/notifications`, waiting);
    expect(told.map((row: { text: string; link: string }) => [row.text, row.link])).toEqual([
      ["Your company is approved. Customers can now see and order your items.", "/items"],
    ]);
  });

  test("a save of the profile or a rename never undoes or gives approval", async () => {
    const signedUp = await (
      await register("supplier", "w2@approve.example", "Still Waiting")
    ).json();
    await client.send("PATCH", `${API}/company`, signedUp.token, { phone: "123" });
    await client.send("PATCH", `${API}/companies/${signedUp.user.companyId}`, admin, {
      name: "Still Waiting Ltd",
    });
    // Disable and enable is not an approval.
    const path = `${API}/companies/${signedUp.user.companyId}`;
    await client.send("PATCH", path, admin, { disabled: true });
    const enabled = await client.send("PATCH", path, admin, { disabled: false });
    expect((await enabled.json()).approvedAt).toBeNull();

    await client.send("PATCH", `${API}/company`, waiting, { phone: "456" });
    expect((await client.json(`${API}/company`, waiting)).approvedAt).not.toBeNull();
  });

  test("two companies cannot have the same name: sign-up, admin create and both renames", async () => {
    const taken = await register("customer", "dup1@approve.example", "  approve BUYER ");
    expect(taken.status).toBe(409);
    expect(await code(taken)).toBe("company_name_taken");
    // Nothing is left behind: the email is still free.
    expect((await client.login("dup1@approve.example")).status).toBe(401);
    expect((await register("customer", "dup1@approve.example", "Fresh Name")).status).toBe(201);
    // The other role does not help.
    expect(await code(await register("supplier", "dup2@approve.example", "Approve Buyer"))).toBe(
      "company_name_taken",
    );

    const made = await client.send("POST", `${API}/companies`, admin, {
      name: "Dup",
      email: "dup3@approve.example",
      password: PASSWORD,
      role: "customer",
      companyName: "EXPO FURNITURE",
    });
    expect(made.status).toBe(409);
    expect(await code(made)).toBe("company_name_taken");

    const byAdmin = await client.send("PATCH", `${API}/companies/${waitingId}`, admin, {
      name: "Approve Buyer",
    });
    expect(byAdmin.status).toBe(409);
    expect(await code(byAdmin)).toBe("company_name_taken");
    const byOwner = await client.send("PATCH", `${API}/company`, waiting, { name: "fresh name" });
    expect(byOwner.status).toBe(409);
    expect(await code(byOwner)).toBe("company_name_taken");
    expect((await client.json(`${API}/company`, waiting)).name).toBe("Expo Furniture");

    // Its own name in another case is fine, and a free name works. The old name is free again.
    const sameName = await client.send("PATCH", `${API}/company`, waiting, {
      name: "EXPO Furniture",
    });
    expect(sameName.status).toBe(200);
    const renamed = await client.send("PATCH", `${API}/companies/${waitingId}`, admin, {
      name: "Expo Rental",
    });
    expect(renamed.status).toBe(200);
    expect((await register("supplier", "dup4@approve.example", "Expo Furniture")).status).toBe(201);
  });
});
