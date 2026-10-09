import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Booking, busiestDay, overbooked } from "../app/services/bookings";
import { type Account, API, World } from "./support/world";

function booking(from: string, to: string, quantity: number): Booking {
  return { itemId: "item", from, to, quantity };
}

describe("the busiest day (D16)", () => {
  const early = booking("2027-05-01", "2027-05-02", 5);
  const late = booking("2027-05-09", "2027-05-10", 5);

  test("orders that never meet are not added up", () => {
    expect(busiestDay([early, late], "2027-05-01", "2027-05-10")).toBe(5);
    expect(busiestDay([early, late], "2027-05-03", "2027-05-08")).toBe(0);
    expect(busiestDay([], "2027-05-01", "2027-05-10")).toBe(0);
  });

  test("orders that meet on one day are added up for that day", () => {
    const middle = booking("2027-05-02", "2027-05-09", 3);
    expect(busiestDay([early, late, middle], "2027-05-01", "2027-05-10")).toBe(8);
    // Both ends count: the last day of one order is the first day of the other.
    expect(busiestDay([early, middle], "2027-05-02", "2027-05-02")).toBe(8);
    expect(busiestDay([early, middle], "2027-05-03", "2027-05-03")).toBe(3);
    // A booking that started before the range still counts on the first day of the range.
    expect(busiestDay([middle], "2027-05-05", "2027-05-06")).toBe(3);
    expect(busiestDay([early], "2027-05-03", "2027-05-04")).toBe(0);
  });

  test("the over-booked days are joined into ranges", () => {
    const middle = booking("2027-05-02", "2027-05-09", 3);
    expect(overbooked([early, late, middle], 6, "2027-04-01")).toEqual([
      { from: "2027-05-02", to: "2027-05-02", booked: 8 },
      { from: "2027-05-09", to: "2027-05-09", booked: 8 },
    ]);
    expect(overbooked([early, late, middle], 2, "2027-04-01")).toEqual([
      { from: "2027-05-01", to: "2027-05-10", booked: 8 },
    ]);
    // Days before `from` are left out, and a range that started before it starts at `from`.
    expect(overbooked([early, late, middle], 2, "2027-05-06")).toEqual([
      { from: "2027-05-06", to: "2027-05-10", booked: 8 },
    ]);
    expect(overbooked([early], 5, "2027-04-01")).toEqual([]);
    // The last day of a month goes on to the next month.
    expect(overbooked([booking("2027-01-30", "2027-02-02", 2)], 1, "2027-01-01")).toEqual([
      { from: "2027-01-30", to: "2027-02-02", booked: 2 },
    ]);
  });
});

describe("availability by date (D16)", () => {
  let world: World;
  let supplier: Account;
  let customer: Account;

  beforeAll(async () => {
    world = await World.create();
    supplier = await world.supplier("Busy Supply");
    customer = await world.customer("Busy Buyer");
  });

  afterAll(async () => {
    await world.close();
  });

  async function accepted(itemId: string, quantity: number, from: string, to: string) {
    const made = await world.order(customer.token, itemId, quantity, from, to);
    expect((await world.act(supplier.token, made.orderId, "accept")).status).toBe(200);
    return made;
  }

  test("a long event gets the pieces that are free on every day (review2 M5)", async () => {
    const item = await world.item(supplier.token, { stock: 10 });
    await accepted(item, 5, "2027-05-01", "2027-05-02");
    await accepted(item, 5, "2027-05-09", "2027-05-10");

    // On every day of 1-10 May at least 5 of the 10 are free.
    const long = await world.project(customer.token, "2027-05-01", "2027-05-10");
    const catalog = await world.json(`/items/catalog?projectId=${long}&limit=200`, customer.token);
    expect(catalog.find((row: { id: string }) => row.id === item).available).toBe(5);
    expect((await world.json(`/items/${item}?projectId=${long}`, customer.token)).available).toBe(
      5,
    );
    expect((await world.addLine(customer.token, long, item, 6)).status).toBe(422);
    const added = await world.addLine(customer.token, long, item, 5);
    expect(added.status).toBe(201);
    expect((await added.json()).lines[0].available).toBe(5);
    // Change, send and accept use the same rule.
    const lineId = (await world.json(`/projects/${long}`, customer.token)).lines[0].id;
    const change = `${API}/projects/${long}/lines/${lineId}`;
    expect((await world.client.send("PATCH", change, customer.token, { quantity: 6 })).status).toBe(
      422,
    );
    const sent = await world.client.sendProject(long, customer.token);
    expect(sent.status).toBe(200);
    const orderId = (await sent.json()).orders[0].id;
    expect((await world.act(supplier.token, orderId, "accept")).status).toBe(200);

    // Now 10 are out on 1-2 May and on 9-10 May, and 5 on the days between.
    const between = await world.project(customer.token, "2027-05-04", "2027-05-06");
    expect(
      (await world.json(`/items/${item}?projectId=${between}`, customer.token)).available,
    ).toBe(5);
    const first = await world.project(customer.token, "2027-05-02", "2027-05-04");
    expect((await world.json(`/items/${item}?projectId=${first}`, customer.token)).available).toBe(
      0,
    );
    expect((await world.addLine(customer.token, first, item, 1)).status).toBe(422);
  });

  test("the setup day of an order holds the item too", async () => {
    const item = await world.item(supplier.token, { stock: 1 });
    const project = await world.project(customer.token, "2027-06-10", "2027-06-11", {
      setupOn: "2027-06-08",
    });
    expect((await world.addLine(customer.token, project, item, 1)).status).toBe(201);
    const sent = await world.client.sendProject(project, customer.token);
    const orderId = (await sent.json()).orders[0].id;
    expect((await world.act(supplier.token, orderId, "accept")).status).toBe(200);
    const onSetup = await world.project(customer.token, "2027-06-07", "2027-06-08");
    expect((await world.addLine(customer.token, onSetup, item, 1)).status).toBe(422);
    const before = await world.project(customer.token, "2027-06-06", "2027-06-07");
    expect((await world.addLine(customer.token, before, item, 1)).status).toBe(201);
  });

  test("the catalog says how many of an item are in the project already (review2 L5)", async () => {
    const item = await world.item(supplier.token, { stock: 5 });
    const project = await world.project(customer.token, "2027-07-01", "2027-07-02");
    expect((await world.addLine(customer.token, project, item, 3)).status).toBe(201);
    const shown = await world.json(`/items/${item}?projectId=${project}`, customer.token);
    expect(shown).toMatchObject({ available: 5, inProject: 3 });
    const catalog = await world.json(
      `/items/catalog?projectId=${project}&limit=200`,
      customer.token,
    );
    expect(catalog.find((row: { id: string }) => row.id === item).inProject).toBe(3);
    // The page offers `available - inProject`. That many fit, one more does not.
    expect((await world.addLine(customer.token, project, item, 3)).status).toBe(422);
    expect((await world.addLine(customer.token, project, item, 2)).status).toBe(201);
    // Without a project nothing is counted.
    expect((await world.json(`/items/${item}`, customer.token)).inProject).toBe(0);
  });

  test("the stock can go below what is booked, and the owner sees the days (review2 L1)", async () => {
    const item = await world.item(supplier.token, { stock: 5 });
    await accepted(item, 5, "2027-08-01", "2027-08-03");
    await accepted(item, 2, "2027-08-10", "2027-08-11");
    const lower = await world.client.send("PATCH", `${API}/items/${item}`, supplier.token, {
      stock: 2,
    });
    expect(lower.status).toBe(200);
    const warning = [{ from: "2027-08-01", to: "2027-08-03", booked: 5 }];
    expect((await lower.json()).overbooked).toEqual(warning);
    const mine = await world.json("/items/mine?limit=200", supplier.token);
    expect(mine.find((row: { id: string }) => row.id === item).overbooked).toEqual(warning);
    expect((await world.json(`/items/${item}`, supplier.token)).overbooked).toEqual(warning);
    // A customer never sees the bookings of a supplier.
    const project = await world.project(customer.token, "2027-08-20", "2027-08-21");
    const forCustomer = await world.json(`/items/${item}?projectId=${project}`, customer.token);
    expect(forCustomer.overbooked).toEqual([]);
    const catalog = await world.json(
      `/items/catalog?projectId=${project}&limit=200`,
      customer.token,
    );
    expect(catalog.find((row: { id: string }) => row.id === item).overbooked).toEqual([]);
    // Enough stock again: the warning is gone. An event that is over gives no warning.
    await world.client.send("PATCH", `${API}/items/${item}`, supplier.token, { stock: 5 });
    expect((await world.json(`/items/${item}`, supplier.token)).overbooked).toEqual([]);
    await world.client.send("PATCH", `${API}/items/${item}`, supplier.token, { stock: 2 });
    world.context.clock.time = Date.parse("2027-08-05T12:00:00Z");
    expect((await world.json(`/items/${item}`, supplier.token)).overbooked).toEqual([]);
    world.context.clock.time = Date.parse("2026-09-01T12:00:00Z");
  });

  test("the supplier sees what is free for the dates of a waiting order", async () => {
    const limited = await world.item(supplier.token, { stock: 3, name: "Limited booth" });
    const free = await world.item(supplier.token, { name: "Carpet with no limit" });
    await accepted(limited, 2, "2027-09-01", "2027-09-03");
    const project = await world.project(customer.token, "2027-09-02", "2027-09-04");
    expect((await world.addLine(customer.token, project, limited, 1)).status).toBe(201);
    expect((await world.addLine(customer.token, project, free, 4)).status).toBe(201);
    const sent = await world.client.sendProject(project, customer.token);
    const orderId = (await sent.json()).orders[0].id;

    const lines = (await world.json(`/orders/${orderId}`, supplier.token)).lines;
    const byName = new Map<string, { stock: number | null; available: number | null }>();
    for (const line of lines) {
      byName.set(line.itemName, line);
    }
    expect(byName.get("Limited booth")).toMatchObject({ stock: 3, available: 1 });
    expect(byName.get("Carpet with no limit")).toMatchObject({ stock: null, available: null });
    // The customer does not get the numbers of the supplier on the order.
    const forCustomer = (await world.json(`/orders/${orderId}`, customer.token)).lines;
    expect(forCustomer.every((line: { available: null }) => line.available === null)).toBe(true);

    // The stock goes down: the order is short, the page knows it before the click, and
    // the accept is refused with the same number.
    await world.client.send("PATCH", `${API}/items/${limited}`, supplier.token, { stock: 2 });
    const short = (await world.json(`/orders/${orderId}`, supplier.token)).lines.find(
      (line: { itemName: string }) => line.itemName === "Limited booth",
    );
    expect(short).toMatchObject({ quantity: 1, available: 0 });
    const refused = await world.act(supplier.token, orderId, "accept");
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("not_enough_stock");
    // An accepted order shows no number: its own pieces are part of what is booked.
    await world.client.send("PATCH", `${API}/items/${limited}`, supplier.token, { stock: 3 });
    expect((await world.act(supplier.token, orderId, "accept")).status).toBe(200);
    const after = (await world.json(`/orders/${orderId}`, supplier.token)).lines;
    expect(after.every((line: { available: null }) => line.available === null)).toBe(true);
  });
});
