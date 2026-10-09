import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const API = "/api/v1";

/** The rules of stock by date, the copy of the event on an order, the price check and "done". */
describe("order, stock and project rules", () => {
  let context: TestApp;
  let client: Client;
  let supplier: string;
  let customer: string;
  let otherCustomer: string;
  let count = 0;

  async function createItem(token: string, extra: object = {}) {
    const body = { name: `Item ${++count}`, category: "Stand", priceCents: 1000, ...extra };
    const response = await client.send("POST", `${API}/items`, token, body);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  async function createProject(startsOn: string, endsOn: string, extra: object = {}) {
    const body = { name: `Fair ${++count}`, startsOn, endsOn, ...extra };
    const response = await client.send("POST", `${API}/projects`, customer, body);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  function addLine(projectId: string, itemId: string, quantity: number) {
    return client.send("POST", `${API}/projects/${projectId}/lines`, customer, {
      itemId,
      quantity,
    });
  }

  /** A sent order of the customer for one item. Returns the ids of the project and the order. */
  async function order(itemId: string, quantity: number, startsOn: string, endsOn: string) {
    const projectId = await createProject(startsOn, endsOn);
    expect((await addLine(projectId, itemId, quantity)).status).toBe(201);
    const sent = await client.sendProject(projectId, customer);
    expect(sent.status).toBe(200);
    return { projectId, orderId: (await sent.json()).orders[0].id as string };
  }

  function act(token: string, orderId: string, action: string, body?: object) {
    return client.send("POST", `${API}/orders/${orderId}/${action}`, token, body);
  }

  async function error(response: Response) {
    return (await response.json()).error as { code: string; message: string };
  }

  /** How many of the item are free on the dates of the project, as the catalog says. */
  async function available(itemId: string, projectId?: string) {
    const query = projectId ? `?projectId=${projectId}` : "";
    const one = await client.json(`${API}/items/${itemId}${query}`, customer);
    const sep = projectId ? "&" : "?";
    const list = await client.json(`${API}/items/catalog${query}${sep}limit=200`, customer);
    const row = list.find((item: { id: string }) => item.id === itemId);
    // The list and the single item must agree.
    expect(row.available).toBe(one.available);
    return one.available as number | null;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    supplier = (await client.signUp("supplier", "s@rules.example", "Rule Supply")).token;
    customer = (await client.signUp("customer", "c@rules.example", "Rule Buyer")).token;
    otherCustomer = (await client.signUp("customer", "o@rules.example", "Other Buyer")).token;
  });

  afterAll(async () => {
    await context.sql.close();
  });

  describe("stock is availability by event dates", () => {
    test("an accepted order holds its items from the setup day to the last day, edges included", async () => {
      const chair = await createItem(supplier, { stock: 5 });
      // Setup on the 18th, event from the 20th to the 23rd.
      const held = await createProject("2026-11-20", "2026-11-23", { setupOn: "2026-11-18" });
      await addLine(held, chair, 3);
      const sent = await (await client.sendProject(held, customer)).json();
      // A pending order holds nothing.
      const sameDays = await createProject("2026-11-20", "2026-11-23");
      expect(await available(chair, sameDays)).toBe(5);
      expect((await act(supplier, sent.orders[0].id, "accept")).status).toBe(200);

      const cases: [string, string, number][] = [
        ["2026-11-10", "2026-11-17", 5], // ends the day before the setup
        ["2026-11-10", "2026-11-18", 2], // ends on the setup day
        ["2026-11-19", "2026-11-19", 2], // between the setup and the first day
        ["2026-11-21", "2026-11-22", 2], // inside
        ["2026-11-01", "2026-12-31", 2], // around
        ["2026-11-23", "2026-11-25", 2], // starts on the last day
        ["2026-11-24", "2026-11-26", 5], // starts the day after
      ];
      for (const [startsOn, endsOn, free] of cases) {
        const projectId = await createProject(startsOn, endsOn);
        expect(await available(chair, projectId)).toBe(free);
        // One more than what is free is refused. What is free can be added.
        const tooMany = await addLine(projectId, chair, free + 1);
        expect(tooMany.status).toBe(422);
        expect((await error(tooMany)).code).toBe("not_enough_stock");
        expect((await addLine(projectId, chair, free)).status).toBe(201);
        const detail = await client.json(`${API}/projects/${projectId}`, customer);
        expect(detail.lines[0]).toMatchObject({ stock: 5, available: free });
      }
      // The setup day of the asking project widens its own range too.
      const early = await createProject("2026-11-25", "2026-11-26", { setupOn: "2026-11-23" });
      expect(await available(chair, early)).toBe(2);

      // The stock is the total. An order never lowers it. With no project it is what shows.
      expect(await available(chair)).toBe(5);
      const mine = await client.json(`${API}/items/${chair}`, supplier);
      expect(mine).toMatchObject({ stock: 5, available: 5 });

      // A completed order still holds its dates.
      expect((await act(supplier, sent.orders[0].id, "complete")).status).toBe(200);
      expect(await available(chair, sameDays)).toBe(2);
    });

    test("no stock limit is never checked, and an own item is not checked by date", async () => {
      const endless = await createItem(supplier, { stock: null });
      const own = await createItem(customer, { stock: 1 });
      const first = await order(endless, 10000, "2026-12-01", "2026-12-02");
      expect((await act(supplier, first.orderId, "accept")).status).toBe(200);
      const projectId = await createProject("2026-12-01", "2026-12-02");
      expect(await available(endless, projectId)).toBeNull();
      expect((await addLine(projectId, endless, 10000)).status).toBe(201);

      // More than the own stock. It is the customer's own thing, so it is not refused.
      expect((await addLine(projectId, own, 5)).status).toBe(201);
      const detail = await client.json(`${API}/projects/${projectId}`, customer);
      expect(detail.lines[1]).toMatchObject({ state: "own", quantity: 5, stock: 1, available: 1 });
      expect(await available(own, projectId)).toBe(1);
    });

    test("the availability is checked again on send and on accept", async () => {
      const lamp = await createItem(supplier, { stock: 4, name: "Date lamp" });
      const first = await order(lamp, 3, "2027-01-10", "2027-01-12");
      const second = await createProject("2027-01-12", "2027-01-14");
      expect((await addLine(second, lamp, 3)).status).toBe(201);
      const third = await order(lamp, 2, "2027-01-11", "2027-01-11");

      // The first order is accepted after the line was added. Only 1 is free now.
      expect((await act(supplier, first.orderId, "accept")).status).toBe(200);
      const refused = await client.sendProject(second, customer);
      expect(refused.status).toBe(409);
      expect(await error(refused)).toEqual({
        code: "not_enough_stock",
        message: '"Date lamp" has only 1 available for your dates. You asked for 3.',
      });
      expect((await client.json(`${API}/projects/${second}`, customer)).orders).toEqual([]);

      // The third order was sent before. It cannot be accepted any more.
      const late = await act(supplier, third.orderId, "accept");
      expect(late.status).toBe(409);
      expect((await error(late)).code).toBe("not_enough_stock");
      expect((await client.json(`${API}/orders/${third.orderId}`, supplier)).status).toBe(
        "pending",
      );
      expect((await client.json(`${API}/items/${lamp}`, supplier)).stock).toBe(4);
    });

    test("two accepts at the same moment for the last piece: one wins, the other gets 409", async () => {
      for (let round = 0; round < 5; round++) {
        const item = await createItem(supplier, { stock: 5 });
        const one = await order(item, 4, "2027-02-01", "2027-02-03");
        const two = await order(item, 4, "2027-02-03", "2027-02-05");
        const answers = await Promise.all([
          act(supplier, one.orderId, "accept"),
          act(supplier, two.orderId, "accept"),
        ]);
        const statuses = [answers[0].status, answers[1].status].sort();
        expect(statuses).toEqual([200, 409]);
        const loser = answers[0].status === 409 ? answers[0] : answers[1];
        expect((await error(loser)).code).toBe("not_enough_stock");
      }
    });

    test("the supplier cancels an accepted order with a reason, and the dates are free again", async () => {
      const booth = await createItem(supplier, { stock: 1 });
      const { projectId, orderId } = await order(booth, 1, "2027-03-01", "2027-03-03");
      const next = await createProject("2027-03-02", "2027-03-04");
      expect((await act(supplier, orderId, "accept")).status).toBe(200);
      expect(await available(booth, next)).toBe(0);
      const none = await addLine(next, booth, 1);
      expect(await error(none)).toMatchObject({ code: "not_enough_stock" });

      // The customer cannot cancel an accepted order. The supplier needs a reason.
      expect((await act(customer, orderId, "cancel")).status).toBe(409);
      const noReason = await act(supplier, orderId, "cancel", {});
      expect(noReason.status).toBe(422);
      expect((await error(noReason)).message).toBe("Write a reason.");
      expect((await act(supplier, orderId, "cancel", { reason: " " })).status).toBe(422);
      expect((await act(otherCustomer, orderId, "cancel", { reason: "x" })).status).toBe(404);

      const cancelled = await act(supplier, orderId, "cancel", { reason: "The booth broke." });
      expect(cancelled.status).toBe(200);
      const body = await cancelled.json();
      expect(body).toMatchObject({ status: "cancelled", rejectReason: "The booth broke." });
      expect(body.decidedAt).not.toBeNull();
      expect(body.decidedBy).not.toBeNull();
      // Twice is refused.
      expect((await act(supplier, orderId, "cancel", { reason: "Again." })).status).toBe(409);

      expect(await available(booth, next)).toBe(1);
      expect((await addLine(next, booth, 1)).status).toBe(201);
      // The project of the cancelled order is a draft again, and can change its dates.
      const project = (await client.json(`${API}/projects/${projectId}`, customer)).project;
      expect(project).toMatchObject({ status: "draft", eventLocked: false });
    });

    test("availability is asked only for my own project", async () => {
      const item = await createItem(supplier, { stock: 2 });
      const mine = await createProject("2027-04-01", "2027-04-02");
      const one = `${API}/items/${item}?projectId=${mine}`;
      expect((await client.send("GET", one, otherCustomer)).status).toBe(404);
      const list = `${API}/items/catalog?projectId=${mine}`;
      expect((await client.send("GET", list, otherCustomer)).status).toBe(404);
      expect((await client.send("GET", `${API}/items/catalog?projectId=x`, customer)).status).toBe(
        422,
      );
    });
  });

  describe("an order is a copy of the event", () => {
    test("the order keeps the facts from the moment of sending, and the project is locked", async () => {
      const item = await createItem(supplier);
      const event = {
        venue: "Expo Hall",
        city: "Yangon",
        hall: "A",
        boothNumber: "A-12",
        boothWidthCm: 600,
        boothDepthCm: 300,
        setupOn: "2027-05-08",
        notes: "Deliver at gate 2.",
      };
      const projectId = await createProject("2027-05-10", "2027-05-12", event);
      const path = `${API}/projects/${projectId}`;
      await addLine(projectId, item, 1);
      const sent = await (await client.sendProject(projectId, customer)).json();
      const orderId = sent.orders[0].id as string;
      expect(sent.project.eventLocked).toBe(true);
      const copy = { ...event, startsOn: "2027-05-10", endsOn: "2027-05-12", id: projectId };

      // The name and the notes can still change. The order keeps its own copy.
      const renamed = await client.send("PATCH", path, customer, {
        name: "New name",
        notes: "SECRET: new notes",
      });
      expect(renamed.status).toBe(200);
      const seen = await client.json(`${API}/orders/${orderId}`, supplier);
      expect(seen.project).toMatchObject(copy);
      expect(seen.project.name).not.toBe("New name");
      expect(seen.projectName).toBe(seen.project.name);

      // Every fact of the event is locked while the order waits, and after it is accepted.
      const changes: object[] = [
        { startsOn: "2027-05-09" },
        { endsOn: "2027-06-01" },
        { setupOn: null },
        { venue: "Other Hall" },
        { city: "Mandalay" },
        { hall: "B" },
        { boothNumber: "B-1" },
        { boothWidthCm: 601 },
        { boothDepthCm: null },
      ];
      for (const status of ["pending", "accepted"]) {
        for (const change of changes) {
          const refused = await client.send("PATCH", path, customer, change);
          expect(refused.status).toBe(409);
          const { code, message } = await error(refused);
          expect(code).toBe("project_locked");
          expect(message).toContain("Cancel the waiting orders first, or ask the supplier.");
        }
        // The form sends every field. The same values are no change.
        const same = await client.send("PATCH", path, customer, {
          ...event,
          notes: "More notes",
          startsOn: "2027-05-10",
          endsOn: "2027-05-12",
        });
        expect(same.status).toBe(200);
        if (status === "pending") {
          expect((await act(supplier, orderId, "accept")).status).toBe(200);
        }
      }

      // After "completed" the deal is over. The project can change, the order cannot.
      expect((await act(supplier, orderId, "complete")).status).toBe(200);
      const moved = await client.send("PATCH", path, customer, { endsOn: "2027-12-31" });
      expect(moved.status).toBe(200);
      expect((await moved.json()).eventLocked).toBe(false);
      const after = await client.json(`${API}/orders/${orderId}`, supplier);
      expect(after.project).toMatchObject(copy);
      expect(after.endsOn).toBe("2027-05-12");
      const listed = await client.json(`${API}/orders?limit=200`, supplier);
      expect(listed.find((row: { id: string }) => row.id === orderId)).toMatchObject({
        endsOn: "2027-05-12",
        venue: "Expo Hall",
      });
    });

    test("a rejected or cancelled order shows no contact details", async () => {
      const item = await createItem(supplier);
      const contact = {
        customerContactEmail: "c@rules.example",
        customerContactName: "Rule Buyer",
        supplierContactEmail: "s@rules.example",
      };
      const hidden = {
        customerContactEmail: null,
        customerContactName: null,
        customerPhone: "",
        supplierContactEmail: null,
        supplierContactName: null,
        supplierPhone: "",
      };
      await client.send("PATCH", `${API}/company`, customer, { phone: "+95 1 234" });

      const kept = await order(item, 1, "2027-06-01", "2027-06-02");
      const path = `${API}/orders/${kept.orderId}`;
      expect(await client.json(path, supplier)).toMatchObject({
        ...contact,
        customerPhone: "+95 1 234",
      });
      await act(supplier, kept.orderId, "accept");
      expect(await client.json(path, supplier)).toMatchObject(contact);
      await act(supplier, kept.orderId, "complete");
      expect(await client.json(path, supplier)).toMatchObject(contact);

      const rejected = await order(item, 1, "2027-06-01", "2027-06-02");
      const answer = await act(supplier, rejected.orderId, "reject", { reason: "No." });
      expect(await answer.json()).toMatchObject(hidden);
      expect(await client.json(`${API}/orders/${rejected.orderId}`, supplier)).toMatchObject(
        hidden,
      );

      const cancelled = await order(item, 1, "2027-06-01", "2027-06-02");
      await act(customer, cancelled.orderId, "cancel");
      for (const token of [supplier, customer]) {
        const seen = await client.json(`${API}/orders/${cancelled.orderId}`, token);
        expect(seen).toMatchObject({ ...hidden, status: "cancelled" });
      }
    });
  });

  describe("the customer confirms the price", () => {
    test("a send with another total than the real one makes no order", async () => {
      const item = await createItem(supplier, { priceCents: 1000 });
      const projectId = await createProject("2027-07-01", "2027-07-02");
      await addLine(projectId, item, 2);
      const path = `${API}/projects/${projectId}/send`;

      const missing = await client.send("POST", path, customer, {});
      expect(missing.status).toBe(422);
      // The supplier raises the price after the customer saw 20.00.
      await client.send("PATCH", `${API}/items/${item}`, supplier, { priceCents: 9000 });
      const changed = await client.send("POST", path, customer, { expectedTotalCents: 2000 });
      expect(changed.status).toBe(409);
      expect(await error(changed)).toEqual({
        code: "prices_changed",
        message: "Prices changed. Check the new total and send again.",
      });
      const detail = await client.json(`${API}/projects/${projectId}`, customer);
      expect(detail.orders).toEqual([]);
      expect(detail.lines[0]).toMatchObject({ state: "not_sent", lineTotalCents: 18000 });

      const sent = await client.send("POST", path, customer, { expectedTotalCents: 18000 });
      expect(sent.status).toBe(200);
      expect((await sent.json()).orders[0].totalCents).toBe(18000);
    });

    test("the total is the sum of every new order, and own items count as 0", async () => {
      const second = (await client.signUp("supplier", "s2@rules.example", "Second Supply")).token;
      const projectId = await createProject("2027-07-01", "2027-07-02");
      await addLine(projectId, await createItem(supplier, { priceCents: 300 }), 2);
      await addLine(projectId, await createItem(second, { priceCents: 50 }), 1);
      await addLine(projectId, await createItem(customer, { priceCents: 99999 }), 3);
      const path = `${API}/projects/${projectId}/send`;
      expect((await client.send("POST", path, customer, { expectedTotalCents: 600 })).status).toBe(
        409,
      );
      const sent = await client.send("POST", path, customer, { expectedTotalCents: 650 });
      expect((await sent.json()).orders.length).toBe(2);
    });
  });

  describe("mark as done", () => {
    function done(projectId: string) {
      return client.send("POST", `${API}/projects/${projectId}/done`, customer);
    }

    test("a project with only own items can be done", async () => {
      const own = await createItem(customer);
      const projectId = await createProject("2027-08-01", "2027-08-02");
      // An empty project cannot be done.
      const empty = await done(projectId);
      expect(empty.status).toBe(409);
      expect((await error(empty)).code).toBe("invalid_status");
      await addLine(projectId, own, 2);
      const finished = await done(projectId);
      expect(finished.status).toBe(200);
      expect((await finished.json()).project.status).toBe("done");
    });

    test("a line that is not sent, or an order that waits, blocks done", async () => {
      const item = await createItem(supplier, { name: "Late shelf" });
      const { projectId, orderId } = await order(item, 1, "2027-08-01", "2027-08-02");
      const waiting = await done(projectId);
      expect(waiting.status).toBe(409);
      expect((await error(waiting)).message).toContain("waits for an answer");
      await act(supplier, orderId, "accept");

      // A new line that is not sent yet.
      const extra = await addLine(projectId, await createItem(supplier, { name: "New lamp" }), 1);
      const lineId = (await extra.json()).lines[1].id;
      const unsent = await done(projectId);
      expect(unsent.status).toBe(409);
      expect(await error(unsent)).toEqual({
        code: "invalid_status",
        message: '"New lamp" is not sent yet. Send it or remove it first.',
      });
      await client.send("DELETE", `${API}/projects/${projectId}/lines/${lineId}`, customer);
      expect((await done(projectId)).status).toBe(200);
    });
  });

  describe("dates of a new project", () => {
    test("a new project cannot start in the past, an old one can still change", async () => {
      // The test clock says 1 September 2026, 12:00 UTC.
      const past = { name: "Past", startsOn: "2026-08-30", endsOn: "2026-09-05" };
      const refused = await client.send("POST", `${API}/projects`, customer, past);
      expect(refused.status).toBe(422);
      expect((await error(refused)).message).toBe("The start date cannot be in the past.");
      // Today, and yesterday in UTC (it is still today in some time zones).
      for (const startsOn of ["2026-08-31", "2026-09-01"]) {
        const body = { ...past, startsOn };
        expect((await client.send("POST", `${API}/projects`, customer, body)).status).toBe(201);
      }

      const projectId = await createProject("2026-09-02", "2026-09-03");
      context.clock.time += 30 * 24 * 60 * 60 * 1000;
      const path = `${API}/projects/${projectId}`;
      const changed = await client.send("PATCH", path, customer, {
        city: "Bago",
        endsOn: "2026-09-04",
      });
      expect(changed.status).toBe(200);

      // The home page of the customer lists only events that are not over.
      const soon = await createProject("2026-11-01", "2026-11-02");
      const home = await client.json(`${API}/dashboard`, customer);
      const ids = home.upcomingProjects.map((row: { id: string }) => row.id);
      expect(ids).toContain(soon);
      expect(ids).not.toContain(projectId);
      // The old one is still in progress, so it still counts.
      const open = await client.send("GET", `${API}/projects?limit=1`, customer);
      expect(home.projectsInProgress).toBeLessThanOrEqual(
        Number(open.headers.get("X-Total-Count")),
      );
      expect(home.projectsInProgress).toBeGreaterThan(home.upcomingProjects.length - 1);
      context.clock.time -= 30 * 24 * 60 * 60 * 1000;
    });
  });

  describe("other rules", () => {
    test("an item of a supplier that was disabled after it was added cannot be sent", async () => {
      await context.authService.registerAdmin({
        name: "Root",
        email: "root@rules.example",
        password: PASSWORD,
      });
      const admin = (await client.login("root@rules.example")).token;
      const gone = await client.signUp("supplier", "gone@rules.example", "Gone Supply");
      const item = await createItem(gone.token);
      const projectId = await createProject("2027-09-01", "2027-09-02");
      await addLine(projectId, item, 1);
      const path = `${API}/companies/${gone.user.companyId}`;
      await client.send("PATCH", path, admin, { disabled: true });

      const refused = await client.sendProject(projectId, customer);
      expect(refused.status).toBe(409);
      expect((await error(refused)).code).toBe("item_unavailable");
    });

    test("a removed user leaves an empty `decidedBy` and `createdBy`", async () => {
      const mate = { name: "Mate", email: "mate@rules.example", password: PASSWORD };
      const made = await (await client.send("POST", `${API}/users`, supplier, mate)).json();
      const mateToken = (await client.login(mate.email)).token;
      const { orderId } = await order(await createItem(supplier), 1, "2027-09-01", "2027-09-02");
      await act(mateToken, orderId, "accept");
      const buyer = { name: "Buyer", email: "buyer@rules.example", password: PASSWORD };
      const buyerId = (await (await client.send("POST", `${API}/users`, customer, buyer)).json())
        .id;
      const buyerToken = (await client.login(buyer.email)).token;
      const body = { name: "By a teammate", startsOn: "2027-09-01", endsOn: "2027-09-02" };
      const project = await (await client.send("POST", `${API}/projects`, buyerToken, body)).json();
      expect(project.createdBy).toBe(buyerId);

      expect((await client.send("DELETE", `${API}/users/${made.id}`, supplier)).status).toBe(204);
      expect((await client.send("DELETE", `${API}/users/${buyerId}`, customer)).status).toBe(204);

      // SQLite and PostgreSQL give the same answer: the reference is empty.
      const seen = await client.json(`${API}/orders/${orderId}`, supplier);
      expect(seen).toMatchObject({ status: "accepted", decidedBy: null });
      const after = await client.json(`${API}/projects/${project.id}`, customer);
      expect(after.project.createdBy).toBeNull();
    });

    test("saving an item writes only the fields that were sent", async () => {
      const id = await createItem(supplier, { stock: 10, description: "Old text" });
      // The edit page read the item when the stock was 10.
      const stale = await context.items.findById(id);
      if (!stale) {
        throw new Error("The item is missing.");
      }
      await client.send("PATCH", `${API}/items/${id}`, supplier, { stock: 6, priceCents: 5 });

      stale.description = "Fixed typo";
      await context.items.update(stale, ["description"]);

      const now = await client.json(`${API}/items/${id}`, supplier);
      expect(now).toMatchObject({ description: "Fixed typo", stock: 6, priceCents: 5 });
      // Nothing to save is fine too.
      await context.items.update(stale, []);
      const same = await client.send("PATCH", `${API}/items/${id}`, supplier, {});
      expect(await same.json()).toMatchObject({ description: "Fixed typo", stock: 6 });
    });
  });
});

/** Small rules from the QA round: SKU case, counted orders, hidden lines and passwords. */
describe("small rules", () => {
  test("SKU, order count, a line whose item left the catalog, and passwords", async () => {
    const context = await buildApp();
    const client = new Client(context.app);
    const supplier = (await client.signUp("supplier", "sup@small.example", "Small Supply")).token;
    const customer = (await client.signUp("customer", "cus@small.example", "Small Events")).token;
    const item = { name: "Stool", category: "Furniture", priceCents: 500, sku: "BM-BS-01" };
    const made = await client.send("POST", `${API}/items`, supplier, item);
    const itemId = (await made.json()).id as string;

    // The same SKU in another case is the same SKU.
    const again = await client.send("POST", `${API}/items`, supplier, { ...item, sku: "bm-bs-01" });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("sku_taken");

    // Two orders for the item. The rejected one is not counted in "My items".
    for (const answer of ["accept", "reject"]) {
      const project = { name: `Fair ${answer}`, startsOn: "2027-01-10", endsOn: "2027-01-12" };
      const projectId = (
        await (await client.send("POST", `${API}/projects`, customer, project)).json()
      ).id as string;
      await client.send("POST", `${API}/projects/${projectId}/lines`, customer, {
        itemId,
        quantity: 1,
      });
      const sent = await (await client.sendProject(projectId, customer)).json();
      const body = answer === "reject" ? { reason: "No." } : undefined;
      const path = `${API}/orders/${sent.orders[0].id}/${answer}`;
      expect((await client.send("POST", path, supplier, body)).status).toBe(200);
    }
    const mine = await client.json(`${API}/items/mine`, supplier);
    expect(mine[0].orderCount).toBe(1);

    // A draft line says when its item is hidden, before the customer tries to send.
    const draft = { name: "Draft fair", startsOn: "2027-02-10", endsOn: "2027-02-12" };
    const draftId = (await (await client.send("POST", `${API}/projects`, customer, draft)).json())
      .id as string;
    await client.send("POST", `${API}/projects/${draftId}/lines`, customer, {
      itemId,
      quantity: 1,
    });
    expect((await client.json(`${API}/projects/${draftId}`, customer)).lines[0].inCatalog).toBe(
      true,
    );
    await client.send("PATCH", `${API}/items/${itemId}`, supplier, { hidden: true });
    expect((await client.json(`${API}/projects/${draftId}`, customer)).lines[0].inCatalog).toBe(
      false,
    );

    // A new password cannot be the current one, and not one that is easy to guess.
    const path = `${API}/users/me/password`;
    const same = await client.send("POST", path, customer, {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
    });
    expect(same.status).toBe(422);
    expect((await same.json()).error.code).toBe("same_password");
    const easy = await client.send("POST", path, customer, {
      currentPassword: PASSWORD,
      newPassword: "Password123",
    });
    expect(easy.status).toBe(422);
    expect((await easy.json()).error.message).toBe(
      "New password is too easy to guess. Choose another one.",
    );
    await context.sql.close();
  });
});
