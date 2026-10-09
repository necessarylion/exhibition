import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Account, API, World } from "./support/world";

/** On the admin side an order lives inside its project (D13), and the rules of D17 around it. */
describe("orders inside projects", () => {
  let world: World;
  let admin: string;
  let supplier: Account;
  let customer: Account;
  let item: string;

  beforeAll(async () => {
    world = await World.create();
    admin = await world.admin();
    supplier = await world.supplier("Stuck Supply");
    customer = await world.customer("Stuck Buyer");
    item = await world.item(supplier.token, { name: "Chair", stock: 5 });
  });

  afterAll(async () => {
    await world.close();
  });

  test("an order cannot exist without a project", async () => {
    const sql = world.context.sql;
    /** True when the database refused the row. */
    async function refused(projectId: string | null): Promise<boolean> {
      try {
        await sql`
          INSERT INTO orders (id, number, project_id, customer_company_id, supplier_company_id,
            total_cents, created_at)
          VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${projectId},
            ${customer.user.companyId}, ${supplier.user.companyId}, 0, '2026-01-01T00:00:00.000Z')
        `;
        return false;
      } catch {
        return true;
      }
    }
    // No project at all, and a project that does not exist: the database refuses both.
    expect(await refused(null)).toBe(true);
    expect(await refused(crypto.randomUUID())).toBe(true);
    // The same row with a real project is fine, so it was the project that was missing.
    const { projectId } = await world.order(customer.token, item);
    expect(await refused(projectId)).toBe(false);
    // And a project with an order cannot be deleted from under it.
    let deleted = true;
    try {
      await sql`DELETE FROM projects WHERE id = ${projectId}`;
    } catch {
      deleted = false;
    }
    expect(deleted).toBe(false);
  });

  test("the admin sees every order inside its project, and there is no list of all orders", async () => {
    const { projectId, orderId } = await world.order(customer.token, item, 2);
    const list = await world.json("/projects?limit=200", admin);
    const row = list.find((project: { id: string }) => project.id === projectId);
    expect(row).toMatchObject({ orderCount: 1, pendingOrderCount: 1, totalCents: 2000 });
    const detail = await world.json(`/projects/${projectId}`, admin);
    expect(detail.orders.length).toBe(1);
    expect(detail.orders[0]).toMatchObject({
      id: orderId,
      number: expect.stringMatching(/^ORD-\d+$/),
      supplierCompanyName: "Stuck Supply",
      status: "pending",
      totalCents: 2000,
      rejectReason: null,
    });
    expect(detail.orders[0].lines[0]).toMatchObject({ itemName: "Chair", quantity: 2 });
    // The orders list of an admin is the inbox for the items of the admin company only.
    for (const path of ["/orders", "/orders?all=true", "/orders?limit=200"]) {
      const mine = await world.json(path, admin);
      expect(mine.some((order: { id: string }) => order.id === orderId)).toBe(false);
    }
    // The dashboard rows carry the project, so they link to it.
    const recent = (await world.json("/dashboard", admin)).recentOrders;
    expect(recent.find((order: { id: string }) => order.id === orderId).projectId).toBe(projectId);
  });

  test("the filter 'has waiting orders' gives the projects with an order to answer", async () => {
    const waiting = await world.order(customer.token, item);
    const answered = await world.order(customer.token, item, 1, "2027-04-01", "2027-04-02");
    expect((await world.act(supplier.token, answered.orderId, "accept")).status).toBe(200);
    const draft = await world.project(customer.token);
    const rows = await world.json("/projects?hasWaitingOrders=true&limit=200", admin);
    const ids = rows.map((project: { id: string }) => project.id);
    expect(ids).toContain(waiting.projectId);
    expect(ids).not.toContain(answered.projectId);
    expect(ids).not.toContain(draft);
    expect(
      rows.every((project: { pendingOrderCount: number }) => project.pendingOrderCount > 0),
    ).toBe(true);
    expect((await world.get("/projects?hasWaitingOrders=yes", admin)).status).toBe(422);
  });

  test("a disabled supplier does not leave an accepted order stuck (review2 M4)", async () => {
    const stuck = await world.supplier("Closed Supply");
    const chair = await world.item(stuck.token, { name: "Closed chair", stock: 5 });
    const { projectId, orderId } = await world.order(customer.token, chair, 5);
    expect((await world.act(stuck.token, orderId, "accept")).status).toBe(200);
    const off = `${API}/companies/${stuck.user.companyId}`;
    expect((await world.client.send("PATCH", off, admin, { disabled: true })).status).toBe(200);

    // The customer still cannot cancel an accepted order, and the project is locked.
    expect((await world.act(customer.token, orderId, "cancel")).status).toBe(409);
    const cancelProject = `${API}/projects/${projectId}/cancel`;
    expect((await world.client.send("POST", cancelProject, customer.token)).status).toBe(409);
    const edit = `${API}/projects/${projectId}`;
    const moved = { endsOn: "2027-03-04" };
    expect((await world.client.send("PATCH", edit, customer.token, moved)).status).toBe(409);

    // The admin must say why.
    expect((await world.act(admin, orderId, "cancel")).status).toBe(422);
    expect((await world.act(admin, orderId, "cancel", { reason: "   " })).status).toBe(422);
    const cancelled = await world.act(admin, orderId, "cancel", { reason: "The supplier closed." });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      status: "cancelled",
      cancelledBy: "admin",
      rejectReason: "The supplier closed.",
      // A cancelled order shows no contact of the disabled supplier.
      supplierContactEmail: null,
    });

    // The project is free again: a draft that can change and can be cancelled.
    const detail = await world.json(`/projects/${projectId}`, customer.token);
    expect(detail.project).toMatchObject({ status: "draft", eventLocked: false, totalCents: 0 });
    expect((await world.client.send("PATCH", edit, customer.token, moved)).status).toBe(200);
    // The pieces are free again for these dates.
    const other = await world.project(customer.token);
    await world.client.send("PATCH", off, admin, { disabled: false });
    expect((await world.json(`/items/${chair}?projectId=${other}`, customer.token)).available).toBe(
      5,
    );
    expect((await world.client.send("POST", cancelProject, customer.token)).status).toBe(200);
    // The customer was told. (The users of the supplier too.)
    const told = "The platform admin cancelled order";
    expect((await world.notes(customer.token)).some((text) => text.startsWith(told))).toBe(true);
    expect((await world.notes(stuck.token)).some((text) => text.startsWith(told))).toBe(true);
    // A second cancel finds nothing to cancel.
    const again = await world.act(admin, orderId, "cancel", { reason: "Again." });
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toBe(
      "Only an order that is waiting or accepted can do this. This order is cancelled.",
    );
  });

  test("an admin cancels a waiting order too, but never answers for a supplier", async () => {
    const { orderId } = await world.order(customer.token, item);
    for (const action of ["accept", "reject", "complete"]) {
      expect((await world.act(admin, orderId, action, { reason: "No." })).status).toBe(403);
    }
    const cancelled = await world.act(admin, orderId, "cancel", { reason: "Sent by mistake." });
    expect(await cancelled.json()).toMatchObject({ status: "cancelled", cancelledBy: "admin" });
    // Completed and rejected orders are over. Nothing to cancel there.
    const done = await world.order(customer.token, item, 1, "2027-05-01", "2027-05-02");
    await world.act(supplier.token, done.orderId, "accept");
    await world.act(supplier.token, done.orderId, "complete");
    expect((await world.act(admin, done.orderId, "cancel", { reason: "No." })).status).toBe(409);
    // A supplier and a customer still cancel only on their own side.
    const mine = await world.order(customer.token, item, 1, "2027-06-01", "2027-06-02");
    const stranger = await world.supplier("Stranger Supply");
    expect((await world.act(stranger.token, mine.orderId, "cancel", { reason: "x" })).status).toBe(
      404,
    );
    expect((await world.act(supplier.token, mine.orderId, "cancel", { reason: "x" })).status).toBe(
      409,
    );
    const byCustomer = await world.act(customer.token, mine.orderId, "cancel");
    expect(await byCustomer.json()).toMatchObject({ status: "cancelled", cancelledBy: "customer" });
    const accepted = await world.order(customer.token, item, 1, "2027-06-10", "2027-06-11");
    await world.act(supplier.token, accepted.orderId, "accept");
    const bySupplier = await world.act(supplier.token, accepted.orderId, "cancel", { reason: "x" });
    expect(await bySupplier.json()).toMatchObject({ status: "cancelled", cancelledBy: "supplier" });
  });

  test("disabling a company cancels its waiting orders and tells the other company", async () => {
    const gone = await world.supplier("Gone Supply");
    const lamp = await world.item(gone.token, { name: "Lamp" });
    const waiting = await world.order(customer.token, lamp, 1, "2027-07-01", "2027-07-02");
    const second = await world.order(customer.token, lamp, 1, "2027-07-05", "2027-07-06");
    const kept = await world.order(customer.token, lamp, 1, "2027-07-10", "2027-07-11");
    expect((await world.act(gone.token, kept.orderId, "accept")).status).toBe(200);

    // The confirm step of the page reads these numbers.
    const before = await world.json("/companies?type=supplier&q=Gone", admin);
    expect(before[0]).toMatchObject({ pendingOrderCount: 2, acceptedOrderCount: 1 });
    const off = `${API}/companies/${gone.user.companyId}`;
    const adminId = (await world.json("/users/me", admin)).id;
    const toldBefore = (await world.notes(customer.token)).length;
    expect((await world.client.send("PATCH", off, admin, { disabled: true })).status).toBe(200);

    for (const { orderId } of [waiting, second]) {
      expect(await world.json(`/orders/${orderId}`, customer.token)).toMatchObject({
        status: "cancelled",
        cancelledBy: "admin",
        rejectReason: "The supplier is not available any more.",
        decidedBy: adminId,
      });
    }
    expect((await world.json(`/orders/${kept.orderId}`, customer.token)).status).toBe("accepted");
    const after = await world.json("/companies?type=supplier&q=Gone", admin);
    expect(after[0]).toMatchObject({ pendingOrderCount: 0, acceptedOrderCount: 1 });
    const texts = (await world.notes(customer.token)).slice(0, -toldBefore);
    expect(texts.length).toBe(2);
    expect(texts.every((text) => text.startsWith("The platform admin cancelled order"))).toBe(true);
    // Disabling again, renaming and enabling cancel nothing more.
    await world.client.send("PATCH", off, admin, { disabled: true, name: "Gone Supply 2" });
    await world.client.send("PATCH", off, admin, { disabled: false });
    expect((await world.json(`/orders/${kept.orderId}`, customer.token)).status).toBe("accepted");

    // The same for a customer: the supplier is told that the customer is gone.
    const leaving = await world.customer("Leaving Buyer");
    const theirs = await world.order(leaving.token, item, 1, "2027-08-01", "2027-08-02");
    const offCustomer = `${API}/companies/${leaving.user.companyId}`;
    await world.client.send("PATCH", offCustomer, admin, { disabled: true });
    expect(await world.json(`/orders/${theirs.orderId}`, supplier.token)).toMatchObject({
      status: "cancelled",
      rejectReason: "The customer is not available any more.",
    });
  });

  test("'Add these items again' puts the items of a dead order back, once (D17)", async () => {
    const maker = await world.supplier("Again Supply");
    const booth = await world.item(maker.token, {
      name: "Again booth",
      stock: 4,
      priceCents: 9000,
    });
    const carpet = await world.item(maker.token, { name: "Again carpet" });
    const lamp = await world.item(maker.token, { name: "Again lamp", stock: 3 });
    const projectId = await world.project(customer.token, "2027-09-01", "2027-09-03");
    await world.addLine(customer.token, projectId, booth, 2);
    await world.addLine(customer.token, projectId, carpet, 6);
    await world.addLine(customer.token, projectId, lamp, 3);
    const sent = await world.client.sendProject(projectId, customer.token);
    const orderId = (await sent.json()).orders[0].id;
    const again = `${API}/projects/${projectId}/orders/${orderId}/add-again`;

    // A waiting order is not dead.
    expect((await world.client.send("POST", again, customer.token)).status).toBe(409);
    await world.act(maker.token, orderId, "reject", { reason: "Not this week." });
    // The carpet is hidden now, and another order took 2 of the 3 lamps on these dates.
    await world.client.send("PATCH", `${API}/items/${carpet}`, maker.token, { hidden: true });
    const taker = await world.order(customer.token, lamp, 2, "2027-09-02", "2027-09-02");
    await world.act(maker.token, taker.orderId, "accept");

    const response = await world.client.send("POST", again, customer.token);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.notAdded).toEqual([
      '"Again carpet" is not in the catalog any more.',
      '"Again lamp" has only 1 available for your dates. You asked for 3.',
    ]);
    const open = result.lines.filter((line: { state: string }) => line.state === "not_sent");
    expect(open.length).toBe(1);
    expect(open[0]).toMatchObject({ itemName: "Again booth", quantity: 2, lineTotalCents: 18000 });
    // The lines of the rejected order stay as its record.
    expect(result.lines.filter((line: { state: string }) => line.state === "sent").length).toBe(3);

    // A second click adds nothing. A line that is smaller grows to the quantity of the order.
    const twice = await (await world.client.send("POST", again, customer.token)).json();
    expect(twice.lines.filter((line: { state: string }) => line.state === "not_sent")).toHaveLength(
      1,
    );
    const line = `${API}/projects/${projectId}/lines/${open[0].id}`;
    await world.client.send("PATCH", line, customer.token, { quantity: 1 });
    const grown = await (await world.client.send("POST", again, customer.token)).json();
    expect(grown.lines.find((row: { id: string }) => row.id === open[0].id).quantity).toBe(2);
    await world.client.send("PATCH", line, customer.token, { quantity: 4 });
    const kept = await (await world.client.send("POST", again, customer.token)).json();
    expect(kept.lines.find((row: { id: string }) => row.id === open[0].id).quantity).toBe(4);

    // Only the customer of the project, only an order of this project.
    expect((await world.client.send("POST", again, maker.token)).status).toBe(403);
    expect((await world.client.send("POST", again, admin)).status).toBe(403);
    const stranger = await world.customer("Again Stranger");
    expect((await world.client.send("POST", again, stranger.token)).status).toBe(404);
    const foreign = `${API}/projects/${projectId}/orders/${taker.orderId}/add-again`;
    expect((await world.client.send("POST", foreign, customer.token)).status).toBe(404);
    // A closed project takes nothing.
    const closed = await world.order(customer.token, booth, 1, "2027-10-01", "2027-10-02");
    await world.act(customer.token, closed.orderId, "cancel");
    await world.client.send("POST", `${API}/projects/${closed.projectId}/cancel`, customer.token);
    const late = `${API}/projects/${closed.projectId}/orders/${closed.orderId}/add-again`;
    expect((await world.client.send("POST", late, customer.token)).status).toBe(409);
  });

  test("order numbers count up and are easy to say", async () => {
    const first = await world.order(customer.token, item, 1, "2027-11-01", "2027-11-02");
    const next = await world.order(customer.token, item, 1, "2027-11-05", "2027-11-06");
    const a = (await world.json(`/orders/${first.orderId}`, customer.token)).number;
    const b = (await world.json(`/orders/${next.orderId}`, customer.token)).number;
    expect(a).toMatch(/^ORD-\d{4}$/);
    expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1);
    // Two sends at the same moment get two numbers.
    const projects = [await world.project(customer.token), await world.project(customer.token)];
    for (const projectId of projects) {
      await world.addLine(customer.token, projectId, item, 1);
    }
    const sends = await Promise.all([
      world.client.sendProject(projects[0] as string, customer.token),
      world.client.sendProject(projects[1] as string, customer.token),
    ]);
    const numbers = new Set<string>();
    for (const response of sends) {
      expect(response.status).toBe(200);
      numbers.add((await response.json()).orders[0].number);
    }
    expect(numbers.size).toBe(2);
  });

  test("a conflict message uses the words of the pages", async () => {
    const { orderId } = await world.order(customer.token, item, 1, "2027-12-01", "2027-12-02");
    await world.act(supplier.token, orderId, "accept");
    const late = await world.act(customer.token, orderId, "cancel");
    expect((await late.json()).error.message).toBe(
      "Only an order that is waiting can do this. This order is accepted.",
    );
    const { projectId } = await world.order(customer.token, item, 1, "2027-12-05", "2027-12-06");
    await world.client.send("POST", `${API}/projects/${projectId}/cancel`, customer.token);
    const closed = await world.addLine(customer.token, projectId, item, 1);
    expect((await closed.json()).error.message).toBe(
      "This project is cancelled. It cannot change.",
    );
  });
});
