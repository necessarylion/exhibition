import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TokenCleaner } from "../app/services/token-cleaner.service";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const API = "/api/v1";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  text: string;
  link: string;
  readAt: string | null;
}

/** Messages inside the app: who gets which one, the unread count, and that they are private. */
describe("notifications", () => {
  let context: TestApp;
  let client: Client;
  let admin: string;
  let secondAdmin: string;
  let supplier: string;
  let supplierMate: string;
  let otherSupplier: string;
  let customer: string;
  let customerMate: string;
  let otherCustomer: string;
  let itemId: string;
  let count = 0;

  async function list(token: string) {
    const response = await client.send("GET", `${API}/notifications?limit=200`, token);
    expect(response.status).toBe(200);
    return {
      rows: (await response.json()) as Row[],
      unread: Number(response.headers.get("X-Unread-Count")),
      total: Number(response.headers.get("X-Total-Count")),
    };
  }

  /** The texts of the notifications of a user, the newest first. */
  async function texts(token: string) {
    return (await list(token)).rows.map((row) => row.text);
  }

  /** A project of the customer with one item, sent. Returns the order. */
  async function order(name: string) {
    const body = { name, startsOn: `2027-01-${10 + ++count}`, endsOn: `2027-01-${10 + count}` };
    const projectId = (await (await client.send("POST", `${API}/projects`, customer, body)).json())
      .id as string;
    await client.send("POST", `${API}/projects/${projectId}/lines`, customer, {
      itemId,
      quantity: 1,
    });
    const sent = await client.sendProject(projectId, customer);
    expect(sent.status).toBe(200);
    const made = (await sent.json()).orders[0] as { id: string; number: string };
    return { ...made, projectId };
  }

  function act(token: string, orderId: string, action: string, body?: object) {
    return client.send("POST", `${API}/orders/${orderId}/${action}`, token, body);
  }

  async function mate(owner: string, email: string) {
    await client.send("POST", `${API}/users`, owner, { name: "Mate", email, password: PASSWORD });
    return (await client.login(email)).token;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
    await context.authService.registerAdmin({
      name: "Root",
      email: "root@note.example",
      password: PASSWORD,
    });
    await context.authService.registerAdmin({
      name: "Second",
      email: "second@note.example",
      password: PASSWORD,
    });
    admin = (await client.login("root@note.example")).token;
    secondAdmin = (await client.login("second@note.example")).token;
    supplier = (await client.signUp("supplier", "s@note.example", "Booth Masters")).token;
    supplierMate = await mate(supplier, "s2@note.example");
    otherSupplier = (await client.signUp("supplier", "o@note.example", "Other Supply")).token;
    customer = (await client.signUp("customer", "c@note.example", "True Money")).token;
    customerMate = await mate(customer, "c2@note.example");
    otherCustomer = (await client.signUp("customer", "oc@note.example", "Other Buyer")).token;
    const item = { name: "Shell booth", category: "Booth", priceCents: 48000 };
    itemId = (await (await client.send("POST", `${API}/items`, supplier, item)).json()).id;
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("a supplier that signs up tells every admin, and nobody else", async () => {
    // The two suppliers above signed up by themselves. A customer sign-up tells nobody.
    const expected = [
      "Other Supply signed up as a supplier and waits for approval.",
      "Booth Masters signed up as a supplier and waits for approval.",
    ];
    expect(await texts(admin)).toEqual(expected);
    expect(await texts(secondAdmin)).toEqual(expected);
    expect((await list(admin)).rows[0]?.link).toBe("/admin/suppliers");
    for (const token of [supplier, supplierMate, otherSupplier, customer, otherCustomer]) {
      expect(await texts(token)).toEqual([]);
    }
    // A company that an admin creates waits for nobody, so it tells nobody.
    await client.send("POST", `${API}/companies`, admin, {
      name: "Made",
      email: "made@note.example",
      password: PASSWORD,
      role: "supplier",
      companyName: "Made Supply",
    });
    expect((await list(admin)).total).toBe(2);
  });

  test("a new order tells every user of the supplier", async () => {
    const made = await order("Tech Expo 2027");
    const text = `True Money sent order ${made.number} for Tech Expo 2027.`;
    expect(await texts(supplier)).toEqual([text]);
    expect(await texts(supplierMate)).toEqual([text]);
    expect((await list(supplier)).rows[0]?.link).toBe(`/orders/${made.id}`);
    // Not the sender, not another supplier, not the admins.
    for (const token of [customer, customerMate, otherSupplier, otherCustomer]) {
      expect(await texts(token)).toEqual([]);
    }
    expect((await list(admin)).total).toBe(2);
  });

  test("accept, reject, cancel by the supplier and complete tell every user of the customer", async () => {
    const first = await order("Fair A");
    const second = await order("Fair B");
    await act(supplier, first.id, "accept");
    await act(supplier, second.id, "reject", { reason: "No booth left." });
    await act(supplier, first.id, "complete");
    const third = await order("Fair C");
    await act(supplier, third.id, "accept");
    await act(supplier, third.id, "cancel", { reason: "The truck broke." });

    const expected = [
      `Booth Masters cancelled order ${third.number} for Fair C. Read the reason.`,
      `Booth Masters accepted order ${third.number} for Fair C.`,
      `Booth Masters completed order ${first.number} for Fair A.`,
      `Booth Masters rejected order ${second.number} for Fair B. Read the reason and pick other items.`,
      `Booth Masters accepted order ${first.number} for Fair A.`,
    ];
    expect(await texts(customer)).toEqual(expected);
    expect(await texts(customerMate)).toEqual(expected);
    expect((await list(customer)).rows[0]?.link).toBe(`/orders/${third.id}`);
    expect(await texts(otherCustomer)).toEqual([]);
    expect(await texts(otherSupplier)).toEqual([]);
    // The supplier got only the new orders, not its own actions.
    expect((await texts(supplier)).every((text) => text.startsWith("True Money sent order"))).toBe(
      true,
    );
  });

  test("a cancel by the customer tells the supplier, also when the whole project is cancelled", async () => {
    const before = (await list(supplier)).total;
    const one = await order("Fair D");
    await act(customer, one.id, "cancel");
    const two = await order("Fair E");
    await client.send("POST", `${API}/projects/${two.projectId}/cancel`, customer);

    const rows = await texts(supplier);
    expect(rows.length).toBe(before + 4);
    expect(rows.slice(0, 4)).toEqual([
      `True Money cancelled order ${two.number} for Fair E.`,
      `True Money sent order ${two.number} for Fair E.`,
      `True Money cancelled order ${one.number} for Fair D.`,
      `True Money sent order ${one.number} for Fair D.`,
    ]);
    // The customer is not told about its own cancel.
    expect((await texts(customer)).some((text) => text.includes("Fair D"))).toBe(false);
  });

  test("an action that fails writes no notification", async () => {
    const before = (await list(customer)).total;
    const made = await order("Fair F");
    // A reject without a reason, and a complete of an order that is not accepted.
    expect((await act(supplier, made.id, "reject", {})).status).toBe(422);
    expect((await act(supplier, made.id, "complete")).status).toBe(409);
    expect((await act(otherSupplier, made.id, "accept")).status).toBe(404);
    expect((await list(customer)).total).toBe(before);
  });

  test("the unread count, mark one as read and mark all as read", async () => {
    const start = await list(customer);
    expect(start.total).toBe(5);
    expect(start.unread).toBe(5);
    // The count is the same on a small page.
    const small = await client.send("GET", `${API}/notifications?limit=1&offset=1`, customer);
    expect(((await small.json()) as Row[]).length).toBe(1);
    expect(small.headers.get("X-Unread-Count")).toBe("5");
    expect(small.headers.get("X-Total-Count")).toBe("5");

    const target = start.rows[2] as Row;
    const read = await client.send("POST", `${API}/notifications/${target.id}/read`, customer);
    expect(read.status).toBe(200);
    const first = (await read.json()).readAt as string;
    expect(first).not.toBeNull();
    expect((await list(customer)).unread).toBe(4);
    // Reading it again keeps the first date.
    const again = await client.send("POST", `${API}/notifications/${target.id}/read`, customer);
    expect((await again.json()).readAt).toBe(first);
    // My teammate has their own copy. It is still new.
    expect((await list(customerMate)).unread).toBe(5);

    expect((await client.send("POST", `${API}/notifications/read`, customer)).status).toBe(204);
    const end = await list(customer);
    expect(end.unread).toBe(0);
    expect(end.total).toBe(5);
    expect(end.rows.every((row) => row.readAt !== null)).toBe(true);
    expect((await list(customerMate)).unread).toBe(5);
  });

  test("another user cannot read or mark my notifications", async () => {
    const mine = (await list(customerMate)).rows[0] as Row;
    const path = `${API}/notifications/${mine.id}/read`;
    // Not a teammate, not another company, not an admin, not without a token.
    for (const token of [customer, otherCustomer, supplier, admin]) {
      expect((await client.send("POST", path, token)).status).toBe(404);
    }
    expect((await context.app.request(path, { method: "POST" })).status).toBe(401);
    expect((await context.app.request(`${API}/notifications`)).status).toBe(401);
    expect(
      (await context.app.request(`${API}/notifications/read`, { method: "POST" })).status,
    ).toBe(401);
    // "Mark all" of another user does not touch mine.
    await client.send("POST", `${API}/notifications/read`, otherCustomer);
    await client.send("POST", `${API}/notifications/read`, admin);
    const after = await list(customerMate);
    expect(after.unread).toBe(5);
    expect(after.rows[0]?.readAt).toBeNull();
    // No list holds a row of another user.
    const ids = new Set(after.rows.map((row) => row.id));
    for (const token of [customer, otherCustomer, supplier, admin]) {
      expect((await list(token)).rows.some((row) => ids.has(row.id))).toBe(false);
    }
    expect(
      (await client.send("POST", `${API}/notifications/not-an-id/read`, customer)).status,
    ).toBe(422);
  });

  test("a removed user takes their notifications with them", async () => {
    const email = "leaver@note.example";
    await mate(customer, email);
    const users = await client.json(`${API}/users`, customer);
    const leaver = users.find((user: { email: string }) => user.email === email);
    const made = await order("Fair G");
    await act(supplier, made.id, "accept");
    const [before] = await context.sql`
      SELECT COUNT(*) AS total FROM notifications WHERE user_id = ${leaver.id}
    `;
    expect(Number(before.total)).toBe(1);
    expect((await client.send("DELETE", `${API}/users/${leaver.id}`, customer)).status).toBe(204);
    const [after] = await context.sql`
      SELECT COUNT(*) AS total FROM notifications WHERE user_id = ${leaver.id}
    `;
    expect(Number(after.total)).toBe(0);
  });

  test("the daily cleaner deletes notifications older than 90 days", async () => {
    const cleaner = new TokenCleaner(
      context.tokens,
      context.notifications,
      context.clock,
      context.adminActions,
    );
    const before = (await list(supplier)).total;
    context.clock.time += 89 * DAY_MS;
    await cleaner.run();
    expect((await list(supplier)).total).toBe(before);
    // One new notification, then two more days: only the new one is young enough.
    const fresh = await order("Late Fair");
    context.clock.time += 2 * DAY_MS;
    await cleaner.run();
    expect(await texts(supplier)).toEqual([`True Money sent order ${fresh.number} for Late Fair.`]);
  });
});
