import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const API = "/api/v1";

/**
 * Organization groups. "True Group" holds the customers "True Money" and "True Sim".
 * They share their items for free. Nobody outside the group sees those items.
 */
describe("organization groups", () => {
  let context: TestApp;
  let client: Client;
  let admin: string;
  let supplier: string;
  let supplierCompanyId: string;
  let money: string;
  let moneyId: string;
  let sim: string;
  let simId: string;
  let outsider: string;
  let groupId: string;
  let stool: string;
  let booth: string;
  let count = 0;

  async function createItem(token: string, extra: object = {}) {
    const body = { name: `Item ${++count}`, category: "Stand", priceCents: 1000, ...extra };
    const response = await client.send("POST", `${API}/items`, token, body);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  async function createProject(token: string) {
    const body = { name: `Fair ${++count}`, startsOn: "2026-11-20", endsOn: "2026-11-23" };
    const response = await client.send("POST", `${API}/projects`, token, body);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  function addLine(token: string, projectId: string, itemId: string, quantity = 1) {
    return client.send("POST", `${API}/projects/${projectId}/lines`, token, { itemId, quantity });
  }

  function member(method: string, group: string, companyId: string, token = admin) {
    return client.send(method, `${API}/organizations/${group}/companies/${companyId}`, token);
  }

  async function createGroup(name: string) {
    const response = await client.send("POST", `${API}/organizations`, admin, { name });
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  /** The ids of the catalog of a customer. */
  async function catalogIds(token: string): Promise<string[]> {
    const items = await client.json(`${API}/items/catalog?limit=200`, token);
    return items.map((item: { id: string }) => item.id);
  }

  /** The catalog and the single item must always agree. */
  async function sees(token: string, itemId: string): Promise<boolean> {
    const inList = (await catalogIds(token)).includes(itemId);
    const one = await client.send("GET", `${API}/items/${itemId}`, token);
    expect(one.status).toBe(inList ? 200 : 404);
    return inList;
  }

  async function code(response: Response) {
    return (await response.json()).error.code as string;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    const account = { name: "Root", email: "root@group.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    admin = (await client.login(account.email)).token;
    const seller = await client.signUp("supplier", "s@group.example", "Booth Masters");
    supplier = seller.token;
    supplierCompanyId = seller.user.companyId;
    ({
      token: money,
      user: { companyId: moneyId },
    } = await client.signUp("customer", "money@group.example", "True Money"));
    ({
      token: sim,
      user: { companyId: simId },
    } = await client.signUp("customer", "sim@group.example", "True Sim"));
    outsider = (await client.signUp("customer", "out@group.example", "Outside Co")).token;
    stool = await createItem(sim, { name: "Bar stool", stock: 2, priceCents: 5000 });
    booth = await createItem(supplier, { name: "Shell booth", priceCents: 48000 });
    groupId = await createGroup("True Group");
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("only an admin manages groups", async () => {
    for (const token of [money, supplier]) {
      const calls = [
        await client.send("GET", `${API}/organizations`, token),
        await client.send("POST", `${API}/organizations`, token, { name: "Mine" }),
        await client.send("GET", `${API}/organizations/${groupId}`, token),
        await client.send("PATCH", `${API}/organizations/${groupId}`, token, { name: "Mine" }),
        await client.send("DELETE", `${API}/organizations/${groupId}`, token),
        await member("PUT", groupId, moneyId, token),
        await member("DELETE", groupId, moneyId, token),
      ];
      expect(calls.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    }
    expect((await context.app.request(`${API}/organizations`)).status).toBe(401);
    // Nothing changed.
    expect((await client.json(`${API}/organizations/${groupId}`, admin)).companies).toEqual([]);
  });

  test("a group name is unique without case, and can be renamed", async () => {
    const taken = await client.send("POST", `${API}/organizations`, admin, {
      name: " true group ",
    });
    expect(taken.status).toBe(409);
    expect(await code(taken)).toBe("group_name_taken");
    expect((await client.send("POST", `${API}/organizations`, admin, { name: "" })).status).toBe(
      422,
    );

    const other = await createGroup("Shwe Holdings");
    const path = `${API}/organizations/${other}`;
    const clash = await client.send("PATCH", path, admin, { name: "TRUE GROUP" });
    expect(await code(clash)).toBe("group_name_taken");
    const renamed = await client.send("PATCH", path, admin, { name: "Shwe Group" });
    expect((await renamed.json()).name).toBe("Shwe Group");
    // Its own name in another case is fine.
    expect((await client.send("PATCH", path, admin, { name: "SHWE GROUP" })).status).toBe(200);
    expect((await client.send("DELETE", path, admin)).status).toBe(204);
    expect((await client.send("GET", path, admin)).status).toBe(404);
  });

  test("before the group has members, nobody sees the item of another customer", async () => {
    expect(await sees(money, stool)).toBe(false);
    expect(await sees(outsider, stool)).toBe(false);
    const projectId = await createProject(money);
    expect((await addLine(money, projectId, stool)).status).toBe(404);
  });

  test("only a customer company can be added, and only to one group", async () => {
    const notCustomer = await member("PUT", groupId, supplierCompanyId);
    expect(notCustomer.status).toBe(409);
    expect(await code(notCustomer)).toBe("not_a_customer");
    const adminCompany = (await client.json(`${API}/company`, admin)).id;
    expect(await code(await member("PUT", groupId, adminCompany))).toBe("not_a_customer");
    expect((await member("PUT", groupId, crypto.randomUUID())).status).toBe(404);
    expect((await member("PUT", crypto.randomUUID(), moneyId)).status).toBe(404);

    expect((await member("PUT", groupId, moneyId)).status).toBe(200);
    const added = await member("PUT", groupId, simId);
    expect((await added.json()).companies).toEqual([
      { id: moneyId, name: "True Money", contactEmail: "money@group.example", itemCount: 0 },
      { id: simId, name: "True Sim", contactEmail: "sim@group.example", itemCount: 1 },
    ]);
    // Adding again changes nothing.
    expect((await member("PUT", groupId, simId)).status).toBe(200);

    const second = await createGroup("Second Group");
    const elsewhere = await member("PUT", second, simId);
    expect(elsewhere.status).toBe(409);
    expect(await code(elsewhere)).toBe("already_in_group");
    // A company that is not in this group cannot be removed from it.
    expect((await member("DELETE", second, simId)).status).toBe(404);
    expect((await client.json(`${API}/organizations/${groupId}`, admin)).companies.length).toBe(2);
    await client.send("DELETE", `${API}/organizations/${second}`, admin);

    // The admin lists show the group of a company.
    const customers = await client.json(`${API}/companies?type=customer`, admin);
    const row = customers.find((company: { id: string }) => company.id === simId);
    expect(row).toMatchObject({ organizationId: groupId, organizationName: "True Group" });
    const free = await client.json(`${API}/companies?type=customer&ungrouped=true`, admin);
    expect(free.map((company: { name: string }) => company.name)).toEqual(["Outside Co"]);
  });

  test("a company sees its group and the other members, an outsider sees none", async () => {
    expect((await client.json(`${API}/company`, money)).organization).toEqual({
      id: groupId,
      name: "True Group",
      companies: [
        { id: moneyId, name: "True Money" },
        { id: simId, name: "True Sim" },
      ],
    });
    expect((await client.json(`${API}/company`, outsider)).organization).toBeNull();
    expect((await client.json(`${API}/company`, supplier)).organization).toBeNull();
  });

  test("the companies of a group see each other's listed items, nobody else does", async () => {
    const mine = await createItem(money, { name: "Brochure rack" });
    expect(await sees(money, stool)).toBe(true);
    expect(await sees(sim, mine)).toBe(true);
    // The other customer, a supplier and a stranger without a token get nothing.
    expect(await sees(outsider, stool)).toBe(false);
    expect(await sees(outsider, mine)).toBe(false);
    expect((await client.send("GET", `${API}/items/${stool}`, supplier)).status).toBe(404);
    expect((await context.app.request(`${API}/items/${stool}`)).status).toBe(401);
    // The outsider cannot add it, with or without a project of its own.
    const theirs = await createProject(outsider);
    expect((await addLine(outsider, theirs, stool)).status).toBe(404);
    expect((await addLine(outsider, theirs, mine)).status).toBe(404);
    // And nobody adds to the project of another company, also not inside the group.
    const moneyProject = await createProject(money);
    expect((await addLine(sim, moneyProject, stool)).status).toBe(404);
    expect((await client.send("GET", `${API}/projects/${moneyProject}`, sim)).status).toBe(404);

    // The shared item shows who owns it. It is the item as it is, with its own price.
    const item = await client.json(`${API}/items/${stool}`, money);
    expect(item).toMatchObject({
      companyId: simId,
      companyName: "True Sim",
      companyType: "customer",
    });
  });

  test("a hidden item and the items of a disabled company are never shared", async () => {
    const hidden = await createItem(sim, { name: "Hidden flag", hidden: true });
    expect(await sees(money, hidden)).toBe(false);
    const projectId = await createProject(money);
    expect((await addLine(money, projectId, hidden)).status).toBe(404);

    // Hiding a shared item takes it away at once. Showing it brings it back.
    await client.send("PATCH", `${API}/items/${stool}`, sim, { hidden: true });
    expect(await sees(money, stool)).toBe(false);
    await client.send("PATCH", `${API}/items/${stool}`, sim, { hidden: false });
    expect(await sees(money, stool)).toBe(true);

    await client.send("PATCH", `${API}/companies/${simId}`, admin, { disabled: true });
    expect(await sees(money, stool)).toBe(false);
    await client.send("PATCH", `${API}/companies/${simId}`, admin, { disabled: false });
    sim = (await client.login("sim@group.example")).token;
    expect(await sees(money, stool)).toBe(true);
  });

  test("a shared line is free, has no order and no approval, and the owner sees nothing of it", async () => {
    const projectId = await createProject(money);
    const path = `${API}/projects/${projectId}`;
    // More than the stock of 2: a shared item is not checked by date, like an own item.
    expect((await addLine(money, projectId, stool, 6)).status).toBe(201);
    expect((await addLine(money, projectId, booth, 1)).status).toBe(201);
    let detail = await client.json(path, money);
    expect(detail.lines[0]).toMatchObject({
      itemId: stool,
      state: "shared",
      companyId: simId,
      companyName: "True Sim",
      quantity: 6,
      unitPriceCents: 0,
      lineTotalCents: 0,
      stock: 2,
      available: 2,
      orderId: null,
    });
    expect(detail.lines[1]).toMatchObject({ state: "not_sent", lineTotalCents: 48000 });
    // The availability of a shared item is its stock, also when asked for the project.
    const forProject = await client.json(`${API}/items/${stool}?projectId=${projectId}`, money);
    expect(forProject.available).toBe(2);

    // The quantity can change and the same item adds up on the same line.
    const shared = detail.lines[0].id as string;
    expect(
      (await client.send("PATCH", `${path}/lines/${shared}`, money, { quantity: 4 })).status,
    ).toBe(200);
    await addLine(money, projectId, stool, 1);
    detail = await client.json(path, money);
    expect(detail.lines.length).toBe(2);
    expect(detail.lines[0].quantity).toBe(5);

    // A wrong total that counts the shared item at its price is refused.
    const wrong = await client.send("POST", `${path}/send`, money, {
      expectedTotalCents: 48000 + 5 * 5000,
    });
    expect(await code(wrong)).toBe("prices_changed");
    // Send makes exactly one order, for the supplier. The shared line is not in it.
    const sent = await (await client.sendProject(projectId, money)).json();
    expect(sent.orders.length).toBe(1);
    expect(sent.orders[0]).toMatchObject({
      supplierCompanyName: "Booth Masters",
      totalCents: 48000,
    });
    expect(sent.orders[0].lines.map((line: { itemId: string }) => line.itemId)).toEqual([booth]);
    expect(sent.project.totalCents).toBe(48000);
    expect(sent.lines[0]).toMatchObject({ state: "shared", orderId: null, orderStatus: null });
    // A second send has nothing: the shared line is never sent.
    expect(await code(await client.sendProject(projectId, money))).toBe("nothing_to_send");

    // The owner of the shared item gets no order, no project and no count of it.
    expect(await client.json(`${API}/orders`, sim)).toEqual([]);
    expect((await client.send("GET", path, sim)).status).toBe(404);
    expect((await client.send("GET", `${API}/orders/${sent.orders[0].id}`, sim)).status).toBe(404);
    const items = await client.json(`${API}/items/mine`, sim);
    expect(items.find((item: { id: string }) => item.id === stool).orderCount).toBe(0);
    expect(await client.json(`${API}/projects`, sim)).toEqual([]);
    const home = await client.json(`${API}/dashboard`, sim);
    expect(home).toMatchObject({ projectsInProgress: 0, ordersWaiting: 0, recentOrders: [] });
    expect(await client.json(`${API}/notifications`, sim)).toEqual([]);

    // The shared line can still change while the order waits, and it does not block "done".
    expect(
      (await client.send("PATCH", `${path}/lines/${shared}`, money, { quantity: 2 })).status,
    ).toBe(200);
    await client.send("POST", `${API}/orders/${sent.orders[0].id}/accept`, supplier);
    const done = await client.send("POST", `${path}/done`, money);
    expect(done.status).toBe(200);
    expect((await done.json()).project.status).toBe("done");
  });

  test("a project with only own and shared items has nothing to send and can be done", async () => {
    const own = await createItem(money, { name: "Own banner" });
    const projectId = await createProject(money);
    await addLine(money, projectId, own, 1);
    await addLine(money, projectId, stool, 1);
    expect(await code(await client.sendProject(projectId, money))).toBe("nothing_to_send");
    const done = await client.send("POST", `${API}/projects/${projectId}/done`, money);
    expect(done.status).toBe(200);
    const states = (await done.json()).lines.map((line: { state: string }) => line.state);
    expect(states).toEqual(["own", "shared"]);
  });

  test("a company that left the group keeps its old shared lines and cannot add new ones", async () => {
    const projectId = await createProject(money);
    const path = `${API}/projects/${projectId}`;
    await addLine(money, projectId, stool, 3);
    const lineId = (await client.json(path, money)).lines[0].id as string;

    const left = await member("DELETE", groupId, moneyId);
    expect((await left.json()).companies.map((company: { name: string }) => company.name)).toEqual([
      "True Sim",
    ]);
    expect((await client.json(`${API}/company`, money)).organization).toBeNull();
    // Both sides lose the view at once.
    expect(await sees(money, stool)).toBe(false);
    const moneyItem = (await client.json(`${API}/items/mine`, money))[0].id as string;
    expect(await sees(sim, moneyItem)).toBe(false);

    // The old line stays as it is: shared and free.
    const detail = await client.json(path, money);
    expect(detail.lines[0]).toMatchObject({ state: "shared", quantity: 3, lineTotalCents: 0 });
    // No new shared line, and no more of the old one: by add or by a new quantity.
    const fresh = await createProject(money);
    expect((await addLine(money, fresh, stool)).status).toBe(404);
    expect((await addLine(money, projectId, stool, 1)).status).toBe(404);
    const more = await client.send("PATCH", `${path}/lines/${lineId}`, money, { quantity: 9 });
    expect(more.status).toBe(409);
    expect(await code(more)).toBe("item_unavailable");
    expect((await client.json(path, money)).lines[0].quantity).toBe(3);
    // It is still never sent, and it can be removed.
    expect(await code(await client.sendProject(projectId, money))).toBe("nothing_to_send");
    expect((await client.send("DELETE", `${path}/lines/${lineId}`, money)).status).toBe(200);

    // Back in the group, it works again.
    expect((await member("PUT", groupId, moneyId)).status).toBe(200);
    expect((await addLine(money, fresh, stool)).status).toBe(201);
  });

  test("deleting a group only takes its companies out", async () => {
    const projectId = await createProject(money);
    await addLine(money, projectId, stool, 2);
    expect((await client.send("DELETE", `${API}/organizations/${groupId}`, admin)).status).toBe(
      204,
    );

    // The companies and their items are still there.
    const customers = await client.json(`${API}/companies?type=customer`, admin);
    expect(customers.map((company: { name: string }) => company.name)).toEqual([
      "Outside Co",
      "True Money",
      "True Sim",
    ]);
    expect(
      customers.every((company: { organizationId: null }) => company.organizationId === null),
    ).toBe(true);
    expect((await client.json(`${API}/items/mine`, sim)).length).toBeGreaterThan(0);
    expect((await client.json(`${API}/company`, sim)).organization).toBeNull();
    // Nothing is shared any more. The old line stays.
    expect(await sees(money, stool)).toBe(false);
    const detail = await client.json(`${API}/projects/${projectId}`, money);
    expect(detail.lines[0]).toMatchObject({ state: "shared", quantity: 2 });
    expect((await addLine(money, await createProject(money), stool)).status).toBe(404);
  });
});
