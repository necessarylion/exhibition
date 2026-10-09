import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

type OrderRow = { number: string; projectName: string; status: string; totalCents: number };

// A small known data set. Every number below comes from these projects:
// - "Main Fair" of Cust: Alpha 56000 (accepted), Beta 5000 (pending), admin 3000 (completed).
// - "Early Fair" of Cust: Alpha 3000 (rejected). "Draft Fair": no order. "Dead Fair": cancelled.
// - "Other Fair" of Other: Alpha 100000 (pending).
describe("dashboard", () => {
  let context: TestApp;
  let client: Client;
  let admin: string;
  let alpha: string;
  let beta: string;
  let customer: string;
  let other: string;

  async function createItem(token: string, name: string, priceCents: number, extra = {}) {
    const body = { name, category: "Stand", priceCents, ...extra };
    return (await (await client.send("POST", "/api/v1/items", token, body)).json()).id as string;
  }

  /** A project with these lines: pairs of item id and quantity. */
  async function project(token: string, name: string, startsOn: string, lines: [string, number][]) {
    const body = { name, startsOn, endsOn: startsOn };
    const id = (await (await client.send("POST", "/api/v1/projects", token, body)).json()).id;
    for (const [itemId, quantity] of lines) {
      const added = await client.send("POST", `/api/v1/projects/${id}/lines`, token, {
        itemId,
        quantity,
      });
      expect(added.status).toBe(201);
    }
    return id as string;
  }

  /** Sends the project. Returns the id of each order by the name of its supplier. */
  async function send(token: string, projectId: string) {
    const sent = await client.sendProject(projectId, token);
    expect(sent.status).toBe(200);
    const ids = new Map<string, string>();
    for (const order of (await sent.json()).orders) {
      ids.set(order.supplierCompanyName, order.id);
    }
    return ids;
  }

  async function act(token: string, orderId: string | undefined, action: string, body?: object) {
    const response = await client.send("POST", `/api/v1/orders/${orderId}/${action}`, token, body);
    expect(response.status).toBe(200);
  }

  function dashboard(token: string) {
    return client.json("/api/v1/dashboard", token);
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    const account = { name: "Root", email: "root@dash.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    admin = (await client.login(account.email)).token;
    alpha = (await client.signUp("supplier", "alpha@dash.example", "Alpha Stands")).token;
    beta = (await client.signUp("supplier", "beta@dash.example", "Beta Light")).token;
    customer = (await client.signUp("customer", "cust@dash.example", "Cust Expo")).token;
    other = (await client.signUp("customer", "other@dash.example", "Other Expo")).token;

    const booth = await createItem(alpha, "Alpha booth", 50000);
    const chair = await createItem(alpha, "Alpha chair", 1500);
    await createItem(alpha, "Alpha hidden", 100, { hidden: true });
    const spot = await createItem(beta, "Beta spot", 2500);
    const truss = await createItem(admin, "Admin truss", 1000);

    const main = await project(customer, "Main Fair", "2026-11-20", [
      [booth, 1],
      [chair, 4],
      [spot, 2],
      [truss, 3],
    ]);
    const mainOrders = await send(customer, main);
    await act(alpha, mainOrders.get("Alpha Stands"), "accept");
    await act(admin, mainOrders.get("Exhibition Platform"), "accept");
    await act(admin, mainOrders.get("Exhibition Platform"), "complete");

    const early = await project(customer, "Early Fair", "2026-10-01", [[chair, 2]]);
    const earlyOrders = await send(customer, early);
    await act(alpha, earlyOrders.get("Alpha Stands"), "reject", { reason: "No stock." });

    await project(customer, "Draft Fair", "2027-01-01", []);
    const dead = await project(customer, "Dead Fair", "2026-09-01", []);
    await client.send("POST", `/api/v1/projects/${dead}/cancel`, customer);

    await send(other, await project(other, "Other Fair", "2026-12-01", [[booth, 2]]));
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("a customer sees the numbers of their own projects and orders", async () => {
    const stats = await dashboard(customer);

    expect(stats).toMatchObject({
      role: "customer",
      // Main (waiting), Early (a draft again after the reject) and Draft. Not the cancelled one.
      projectsInProgress: 3,
      ordersWaiting: 1,
      ordersConfirmed: 2,
      totalSpendCents: 56000 + 3000,
    });
    expect(stats.upcomingProjects.map((row: { name: string }) => row.name)).toEqual([
      "Early Fair",
      "Main Fair",
      "Draft Fair",
    ]);
    expect(stats.upcomingProjects[1]).toMatchObject({
      id: expect.any(String),
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
      status: "waiting",
    });
    expect(stats.recentOrders.length).toBe(4);
    const rejected = stats.recentOrders.find((row: OrderRow) => row.status === "rejected");
    expect(rejected).toMatchObject({
      id: expect.any(String),
      number: expect.stringMatching(/^ORD-/),
      supplierCompanyName: "Alpha Stands",
      projectName: "Early Fair",
      totalCents: 3000,
      createdAt: expect.any(String),
    });

    // Another customer has only their own numbers.
    expect(await dashboard(other)).toMatchObject({
      projectsInProgress: 1,
      ordersWaiting: 1,
      ordersConfirmed: 0,
      totalSpendCents: 0,
    });
  });

  test("a supplier sees the numbers of their own orders and items", async () => {
    const stats = await dashboard(alpha);
    // The orders and the dashboard use the clock of the app. So this is right at midnight too.
    const thisMonth = new Date(context.clock.time).toISOString().slice(0, 7);

    expect(stats).toMatchObject({
      role: "supplier",
      ordersWaiting: 1,
      ordersAccepted: 1,
      revenueCents: 56000,
      // The hidden item does not count.
      itemsListed: 2,
      itemsHidden: 1,
    });
    expect(stats.ordersToAnswer).toEqual([
      expect.objectContaining({
        customerCompanyName: "Other Expo",
        projectName: "Other Fair",
        totalCents: 100000,
      }),
    ]);
    expect(stats.ordersPerMonth.length).toBe(6);
    // Oldest first. Only this month has orders: accepted, rejected and pending.
    // The rejected one is not counted.
    expect(stats.ordersPerMonth.at(-1)).toEqual({ month: thisMonth, count: 2 });
    expect(
      stats.ordersPerMonth.slice(0, 5).every((row: { count: number }) => row.count === 0),
    ).toBe(true);
    expect(stats.ordersPerMonth[0].month < stats.ordersPerMonth[1].month).toBe(true);
    // Only the accepted order counts. The rejected and the pending ones do not.
    expect(stats.topItems).toEqual([
      {
        itemId: expect.any(String),
        itemName: "Alpha chair",
        category: "Stand",
        photoUrl: null,
        orderCount: 1,
        quantity: 4,
        revenueCents: 6000,
      },
      {
        itemId: expect.any(String),
        itemName: "Alpha booth",
        category: "Stand",
        photoUrl: null,
        orderCount: 1,
        quantity: 1,
        revenueCents: 50000,
      },
    ]);
  });

  test("a supplier never sees the numbers of another supplier", async () => {
    const stats = await dashboard(beta);

    expect(stats).toMatchObject({
      role: "supplier",
      ordersWaiting: 1,
      ordersAccepted: 0,
      revenueCents: 0,
      itemsListed: 1,
      topItems: [],
    });
    expect(stats.ordersToAnswer.map((row: OrderRow) => row.totalCents)).toEqual([5000]);
    expect(stats.ordersPerMonth.at(-1).count).toBe(1);
    expect(JSON.stringify(stats)).not.toContain("Alpha");
    expect(JSON.stringify(stats)).not.toContain("Other Fair");
  });

  test("an admin sees every company, and the orders for the admin items", async () => {
    const stats = await dashboard(admin);

    expect(stats).toMatchObject({
      role: "admin",
      customers: 2,
      suppliers: 2,
      projects: 5,
      ordersWaiting: 2,
      orderValueCents: 56000 + 3000,
      asSupplier: {
        ordersWaiting: 0,
        ordersAccepted: 0,
        revenueCents: 3000,
        itemsListed: 1,
        ordersToAnswer: [],
        topItems: [
          expect.objectContaining({ itemName: "Admin truss", quantity: 3, revenueCents: 3000 }),
        ],
      },
    });
    expect(stats.asSupplier.ordersPerMonth.at(-1).count).toBe(1);
    expect(stats.recentProjects.length).toBe(5);
    expect(stats.recentProjects[0]).toMatchObject({
      name: "Other Fair",
      companyName: "Other Expo",
    });
    expect(stats.recentOrders.length).toBe(5);
    expect(stats.recentOrders[0]).toMatchObject({
      customerCompanyName: "Other Expo",
      supplierCompanyName: "Alpha Stands",
      status: "pending",
    });
    // Newest first. The admin company itself is not in the list.
    expect(stats.newestCompanies.map((row: { name: string }) => row.name)).toEqual([
      "Other Expo",
      "Cust Expo",
      "Beta Light",
      "Alpha Stands",
    ]);
    expect(stats.newestCompanies[0]).toMatchObject({ type: "customer", id: expect.any(String) });
    // The hints of the tiles, and the owner of each new company.
    expect(typeof stats.newestCompanies[0].ownerName).toBe("string");
    expect(stats.customersDisabled).toBe(0);
    expect(stats.projectsWaiting).toBeGreaterThanOrEqual(0);
  });

  test("the dashboard needs a token", async () => {
    expect((await context.app.request("/api/v1/dashboard")).status).toBe(401);
  });
});
