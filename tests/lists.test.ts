import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Company } from "../app/models/company.model";
import { PASSWORD } from "./support/build-app";
import { type Account, API, tally, World } from "./support/world";

/** The numbers of a list answer: the rows, `X-Total-Count` and `X-Counts`. */
async function page(world: World, path: string, token: string) {
  const response = await world.get(path, token);
  expect(response.status).toBe(200);
  const rows = await response.json();
  return {
    rows,
    names: rows.map(
      (row: { name?: string; number?: string }) => row.name ?? row.number,
    ) as string[],
    total: Number(response.headers.get("X-Total-Count")),
    counts: JSON.parse(response.headers.get("X-Counts") ?? "{}") as Record<string, number>,
  };
}

/** Lists that are right beyond 1000 rows: search, filters and counts come from the API (D17). */
describe("lists", () => {
  let world: World;
  let admin: string;
  let supplier: Account;
  let customer: Account;

  beforeAll(async () => {
    world = await World.create();
    admin = await world.admin();
    supplier = await world.supplier("List Supply");
    customer = await world.customer("List Buyer");
  });

  afterAll(async () => {
    await world.close();
  });

  test("a project list of 1,050 rows: the search finds the last one and the counts are right", async () => {
    const sql = world.context.sql;
    const many = await world.customer("Many Buyer");
    // Made in the database: 1,050 calls would only test the same insert 1,050 times.
    for (let index = 1; index <= 1050; index++) {
      const day = `2027-${String(1 + (index % 12)).padStart(2, "0")}-10`;
      await sql`
        INSERT INTO projects (id, company_id, name, starts_on, ends_on, created_at)
        VALUES (${crypto.randomUUID()}, ${many.user.companyId}, ${`Bulk fair ${index}`}, ${day},
          ${day}, ${new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()})
      `;
    }
    const needle = await world.project(many.token, "2029-01-01", "2029-01-02", {
      name: "Robot World 2029",
      venue: "Hall_100% North",
    });
    // The first page is 100 rows. The total is the real number.
    const first = await page(world, "/projects", many.token);
    expect(first.rows.length).toBe(100);
    expect(first.total).toBe(1051);
    expect(first.counts).toMatchObject({ draft: 1051, waiting: 0, totalCents: 0 });
    // The needle is the last event, far beyond the first 1,000 rows. The search finds it.
    const last = await page(world, "/projects?limit=200&offset=1000", many.token);
    expect(last.rows.length).toBe(51);
    expect(last.names).toContain("Robot World 2029");
    const found = await page(world, "/projects?q=rObOt%20wOrLd", many.token);
    expect(found.names).toEqual(["Robot World 2029"]);
    expect(found.total).toBe(1);
    expect(found.rows[0].id).toBe(needle);
    // Paging goes through all of them, each once.
    const seen = new Set<string>();
    for (let offset = 0; offset < 1051; offset += 200) {
      for (const row of (await page(world, `/projects?limit=200&offset=${offset}`, many.token))
        .rows) {
        seen.add(row.id);
      }
    }
    expect(seen.size).toBe(1051);
    // `%` and `_` are plain characters, not wildcards.
    expect((await page(world, "/projects?q=100%25", many.token)).names).toEqual([
      "Robot World 2029",
    ]);
    expect((await page(world, "/projects?q=Hall_100", many.token)).names).toEqual([
      "Robot World 2029",
    ]);
    expect((await page(world, "/projects?q=Hall-100", many.token)).total).toBe(0);
    expect((await page(world, "/projects?q=%25", many.token)).total).toBe(1);
    expect((await page(world, "/projects?q=_", many.token)).total).toBe(1);
    expect((await page(world, `/projects?q=${encodeURIComponent("\\")}`, many.token)).total).toBe(
      0,
    );
    expect(
      (await page(world, `/projects?q=${encodeURIComponent("' OR 1=1 --")}`, many.token)).total,
    ).toBe(0);
    // "Adding to" in the catalog asks only for the projects that can still get items.
    await world.client.send("POST", `${API}/projects/${needle}/cancel`, many.token);
    const open = await page(world, "/projects?open=true&q=bulk%20fair%201050", many.token);
    expect(open.names).toEqual(["Bulk fair 1050"]);
    expect((await page(world, "/projects?open=true&q=Robot", many.token)).total).toBe(0);
    expect((await page(world, "/projects?open=true", many.token)).total).toBe(1050);
    // An admin finds it by the name of the customer, and the money total is of all rows.
    const forAdmin = await page(world, "/projects?q=many%20buyer&status=cancelled", admin);
    expect(forAdmin.names).toEqual(["Robot World 2029"]);
    expect(forAdmin.counts).toMatchObject({ draft: 1050, cancelled: 1 });
  });

  test("projects: the status filter, the counts per status and the sum of the orders", async () => {
    const item = await world.item(supplier.token, { priceCents: 2500 });
    const waiting = await world.order(customer.token, item, 2, "2027-03-01", "2027-03-02");
    const confirmed = await world.order(customer.token, item, 4, "2027-04-01", "2027-04-02");
    await world.act(supplier.token, confirmed.orderId, "accept");
    await world.project(customer.token, "2027-05-01", "2027-05-02", {
      name: "Paper Draft",
      city: "Bago",
    });

    const all = await page(world, "/projects", customer.token);
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({
      draft: 1,
      waiting: 1,
      confirmed: 1,
      done: 0,
      cancelled: 0,
      totalCents: 15000,
    });
    const onlyWaiting = await page(world, "/projects?status=waiting", customer.token);
    expect(onlyWaiting.rows.map((row: { id: string }) => row.id)).toEqual([waiting.projectId]);
    // The counts stay those of the search, so every tab keeps its number. The sum is of the rows.
    expect(onlyWaiting.counts).toMatchObject({
      draft: 1,
      waiting: 1,
      confirmed: 1,
      totalCents: 5000,
    });
    expect(onlyWaiting.total).toBe(1);
    const byCity = await page(world, "/projects?q=bago", customer.token);
    expect(byCity.names).toEqual(["Paper Draft"]);
    expect(byCity.counts).toMatchObject({ draft: 1, waiting: 0, confirmed: 0, totalCents: 0 });
    // The events to come are first, the next one at the top. Events that are over come last.
    world.context.clock.time = Date.parse("2027-03-20T12:00:00Z");
    const sorted = await page(world, "/projects", customer.token);
    expect(sorted.rows.map((row: { startsOn: string }) => row.startsOn)).toEqual([
      "2027-04-01",
      "2027-05-01",
      "2027-03-01",
    ]);
    world.context.clock.time = Date.parse("2026-09-01T12:00:00Z");
    // A search never shows a project of another company.
    const stranger = await world.customer("List Stranger");
    expect((await page(world, "/projects?q=Paper", stranger.token)).total).toBe(0);
  });

  test("orders: search, status, the counts per status and the sum without dead orders", async () => {
    const maker = await world.supplier("Order Maker");
    const buyer = await world.customer("Zebra Buyer");
    const item = await world.item(maker.token, { priceCents: 1000 });
    const a = await world.order(buyer.token, item, 1, "2028-01-01", "2028-01-02");
    const b = await world.order(buyer.token, item, 2, "2028-02-01", "2028-02-02");
    const c = await world.order(buyer.token, item, 3, "2028-03-01", "2028-03-02");
    await world.order(customer.token, item, 5, "2028-04-01", "2028-04-02");
    await world.act(maker.token, b.orderId, "accept");
    await world.act(maker.token, c.orderId, "reject", { reason: "No." });

    const all = await page(world, "/orders", maker.token);
    expect(all.total).toBe(4);
    expect(all.counts).toEqual({
      pending: 2,
      accepted: 1,
      rejected: 1,
      cancelled: 0,
      completed: 0,
      totalCents: 8000,
    });
    const zebra = await page(world, "/orders?q=zebra", maker.token);
    expect(zebra.total).toBe(3);
    expect(zebra.counts).toMatchObject({ pending: 1, accepted: 1, rejected: 1, totalCents: 3000 });
    const rejected = await page(world, "/orders?q=zebra&status=rejected", maker.token);
    expect(rejected.total).toBe(1);
    expect(rejected.counts).toMatchObject({ pending: 1, rejected: 1, totalCents: 0 });
    const number = (await world.json(`/orders/${a.orderId}`, maker.token)).number;
    expect((await page(world, `/orders?q=${number.toLowerCase()}`, maker.token)).names).toEqual([
      number,
    ]);
    // The customer searches by the name of the supplier.
    expect((await page(world, "/orders?q=order%20maker", buyer.token)).total).toBe(3);
    expect((await page(world, "/orders?q=order%20maker", customer.token)).total).toBe(1);
    expect((await page(world, "/orders?limit=2&offset=2", maker.token)).rows.length).toBe(2);
  });

  test("my items and the catalog: search, category, owner, hidden count and categories", async () => {
    const maker = await world.supplier("Item Maker");
    const buyer = await world.customer("Item Buyer");
    await world.item(maker.token, { name: "Oak table", category: "Furniture", sku: "OAK-1" });
    await world.item(maker.token, { name: "Pine table", category: "Furniture" });
    const hidden = await world.item(maker.token, { name: "Old lamp", category: "Lighting" });
    await world.item(maker.token, {
      name: "Spot",
      category: "Lighting",
      description: "Warm OAK tone",
    });
    await world.client.send("PATCH", `${API}/items/${hidden}`, maker.token, { hidden: true });
    await world.item(buyer.token, { name: "Own flag", category: "Graphics" });

    const mine = await page(world, "/items/mine", maker.token);
    expect(mine.total).toBe(4);
    expect(mine.counts).toEqual({ hidden: 1 });
    expect((await page(world, "/items/mine?q=oak", maker.token)).names).toEqual([
      "Oak table",
      "Spot",
    ]);
    expect((await page(world, "/items/mine?q=oak-1", maker.token)).names).toEqual(["Oak table"]);
    const lighting = await page(world, "/items/mine?category=Lighting", maker.token);
    expect(lighting.names).toEqual(["Old lamp", "Spot"]);
    expect(lighting.counts).toEqual({ hidden: 1 });
    expect((await page(world, "/items/mine?category=Lighting&q=spot", maker.token)).counts).toEqual(
      {
        hidden: 0,
      },
    );
    expect(await world.json("/items/categories", maker.token)).toEqual(["Furniture", "Lighting"]);
    expect(await world.json("/items/categories?scope=mine", buyer.token)).toEqual(["Graphics"]);

    // The catalog: a hidden item is in no search, no category list and no count.
    const catalog = await page(world, "/items/catalog?q=item%20maker", buyer.token);
    expect(catalog.names).toEqual(["Oak table", "Pine table", "Spot"]);
    expect(catalog.total).toBe(3);
    expect((await page(world, "/items/catalog?q=old%20lamp", buyer.token)).total).toBe(0);
    const own = await page(world, "/items/catalog?owner=own", buyer.token);
    expect(own.names).toEqual(["Own flag"]);
    const fromSuppliers = await page(
      world,
      "/items/catalog?owner=supplier&category=Lighting&q=maker",
      buyer.token,
    );
    expect(fromSuppliers.names).toEqual(["Spot"]);
    expect((await page(world, "/items/catalog?owner=shared", buyer.token)).total).toBe(0);
    const categories = await world.json("/items/categories?scope=catalog", buyer.token);
    expect(categories).toContain("Graphics");
    expect(categories).toContain("Lighting");
    expect(categories).toContain("Furniture");
    // A supplier has no catalog: the scope falls back to its own items.
    expect(await world.json("/items/categories?scope=catalog", maker.token)).toEqual([
      "Furniture",
      "Lighting",
    ]);
    expect((await world.get("/items/catalog?owner=everyone", buyer.token)).status).toBe(422);

    // A group shares: `owner=shared` gives the items of the other company of the group.
    const sister = await world.customer("Item Sister");
    await world.item(sister.token, { name: "Sister arch", category: "Graphics" });
    const group = await (
      await world.client.send("POST", `${API}/organizations`, admin, { name: "Item Group" })
    ).json();
    for (const company of [buyer, sister]) {
      await world.client.send(
        "PUT",
        `${API}/organizations/${group.id}/companies/${company.user.companyId}`,
        admin,
      );
    }
    expect((await page(world, "/items/catalog?owner=shared", buyer.token)).names).toEqual([
      "Sister arch",
    ]);
    expect((await page(world, "/items/catalog?owner=own", buyer.token)).names).toEqual([
      "Own flag",
    ]);
    expect((await page(world, "/organizations?q=sister", admin)).names).toEqual(["Item Group"]);
    expect((await page(world, "/organizations?q=item%20gr", admin)).names).toEqual(["Item Group"]);
    expect((await page(world, "/organizations?q=nobody", admin)).rows).toEqual([]);
  });

  test("companies and users: the count follows the search (qa B4)", async () => {
    await world.customer("Searchable Alpha");
    await world.customer("Searchable Beta");
    await world.supplier("Searchable Waiting", false);
    const found = await page(world, "/companies?type=customer&q=searchable", admin);
    expect(found.names).toEqual(["Searchable Alpha", "Searchable Beta"]);
    expect(found.total).toBe(2);
    expect(found.counts).toEqual({ waiting: 0, disabled: 0 });
    // By the email of the owner too.
    expect((await page(world, "/companies?type=customer&q=searchablebeta@", admin)).names).toEqual([
      "Searchable Beta",
    ]);
    const suppliers = await page(world, "/companies?type=supplier&q=searchable", admin);
    expect(suppliers.counts).toEqual({ waiting: 1, disabled: 0 });
    expect((await page(world, "/companies?type=customer&q=zzzz", admin)).total).toBe(0);
    const ungrouped = await page(world, "/companies?type=customer&ungrouped=true&q=alpha", admin);
    expect(ungrouped.names).toEqual(["Searchable Alpha"]);
    // One company by its id: only for an admin, and never the admin company.
    const one = await world.json(`/companies/${found.rows[0].id}`, admin);
    expect(one).toMatchObject({ name: "Searchable Alpha", type: "customer", pendingOrderCount: 0 });
    expect((await world.get(`/companies/${found.rows[0].id}`, customer.token)).status).toBe(403);
    expect((await world.get(`/companies/${crypto.randomUUID()}`, admin)).status).toBe(404);
    const adminCompany = (await world.json("/users/me", admin)).companyId;
    expect((await world.get(`/companies/${adminCompany}`, admin)).status).toBe(404);

    for (const name of ["Ann Lee", "Bob Stone", "Cara Lee"]) {
      const user = {
        name,
        email: `${name.split(" ")[0]?.toLowerCase()}@list.example`,
        password: PASSWORD,
      };
      expect((await world.client.send("POST", `${API}/users`, customer.token, user)).status).toBe(
        201,
      );
    }
    const lees = await page(world, "/users?q=lee", customer.token);
    expect(lees.names).toEqual(["Ann Lee", "Cara Lee"]);
    expect(lees.total).toBe(2);
    expect((await page(world, "/users?q=BOB@list", customer.token)).names).toEqual(["Bob Stone"]);
    expect((await page(world, "/users?q=zzzz", customer.token)).total).toBe(0);
    expect((await page(world, "/users", customer.token)).total).toBe(4);
    // A search text that is too long is refused, like every other input.
    expect((await world.get(`/users?q=${"x".repeat(101)}`, customer.token)).status).toBe(422);
  });
});

describe("names and codes that look the same (D17)", () => {
  let world: World;
  let admin: string;

  beforeAll(async () => {
    world = await World.create();
    admin = await world.admin();
    await world.supplier("Poc Supply");
  });

  afterAll(async () => {
    await world.close();
  });

  function signUp(companyName: string, email: string) {
    return world.client.post(`${API}/auth/register`, {
      name: "Copy",
      email,
      password: PASSWORD,
      role: "customer",
      companyName,
    });
  }

  test("a name with an invisible or an odd character is the same name (review2 L8)", async () => {
    // The characters are written as codes, so nobody has to guess what is in the text.
    const zeroWidth = String.fromCodePoint(0x200b);
    const joiner = String.fromCodePoint(0x200d);
    const noBreak = String.fromCodePoint(0xa0);
    const byteOrderMark = String.fromCodePoint(0xfeff);
    const softHyphen = String.fromCodePoint(0xad);
    const rightToLeft = String.fromCodePoint(0x202e);
    // "Poc Supply" in wide letters (U+FF30 and on). NFKC turns them into the plain ones.
    let wide = "";
    for (const letter of "Poc Supply") {
      wide +=
        letter === " " ? " " : String.fromCodePoint((letter.codePointAt(0) as number) + 0xfee0);
    }
    const copies = [
      `Poc Supply${zeroWidth}`,
      `Poc${zeroWidth} Sup${joiner}ply`,
      `Poc${noBreak}Supply`,
      "Poc    Supply",
      `${byteOrderMark}Poc Supply`,
      `Poc Sup${softHyphen}ply`,
      `${rightToLeft}Poc Supply`,
      "POC  SUPPLY ",
      wide,
    ];
    let count = 0;
    for (const name of copies) {
      const response = await signUp(name, `copy${++count}@names.example`);
      expect(`${count}: ${response.status}`).toBe(`${count}: 409`);
      expect((await response.json()).error.code).toBe("company_name_taken");
    }
    // A name of only such characters is no name.
    expect((await signUp(`${zeroWidth} ${noBreak}`, "empty@names.example")).status).toBe(422);
    // The clean form is what is stored and shown.
    const made = await signUp(`  Fine${zeroWidth}   Trade${noBreak}Co `, "fine@names.example");
    expect(made.status).toBe(201);
    expect((await made.json()).user.companyName).toBe("Fine Trade Co");
    // A joined "fi" (U+FB01) is the two plain letters after NFKC.
    expect(Company.cleanName(`${String.fromCodePoint(0xfb01)}ne   co`)).toBe("fine co");
    // An admin who renames or creates a company gets the same rule.
    const companies = await world.json("/companies?type=customer&q=fine", admin);
    const rename = { name: `Poc${zeroWidth} Supply` };
    const path = `${API}/companies/${companies[0].id}`;
    expect((await world.client.send("PATCH", path, admin, rename)).status).toBe(409);
    const create = {
      name: "X",
      email: "x@names.example",
      password: PASSWORD,
      role: "supplier",
      companyName: `poc${noBreak}supply`,
    };
    expect((await world.client.send("POST", `${API}/companies`, admin, create)).status).toBe(409);
    // A group name too.
    const groups = `${API}/organizations`;
    expect((await world.client.send("POST", groups, admin, { name: "True Group" })).status).toBe(
      201,
    );
    const twin = await world.client.send("POST", groups, admin, {
      name: `True${zeroWidth}  group`,
    });
    expect(twin.status).toBe(409);
    expect((await twin.json()).error.code).toBe("group_name_taken");
  });

  test("the same SKU in another case cannot be saved twice at the same moment (review2 L10)", async () => {
    const maker = await world.supplier("Sku Supply");
    function make(sku: string) {
      const body = { name: sku, category: "X", priceCents: 1, sku };
      return world.client.send("POST", `${API}/items`, maker.token, body);
    }
    const pair = tally(await Promise.all([make("ab-1"), make("AB-1")]));
    expect(pair).toEqual({ 201: 1, 409: 1 });
    expect((await world.json("/items/mine", maker.token)).length).toBe(1);
    // The index itself refuses it, also when the check of the app is skipped.
    const [row] = await world.context
      .sql`SELECT * FROM items WHERE company_id = ${maker.user.companyId}`;
    let refused = false;
    try {
      await world.context.sql`
        INSERT INTO items (id, company_id, name, category, price_cents, created_at, sku)
        VALUES (${crypto.randomUUID()}, ${row.company_id}, 'Twin', 'X', 1, ${row.created_at},
          ${row.sku === "ab-1" ? "AB-1" : "ab-1"})
      `;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    // Another company can use the same SKU.
    const other = await world.supplier("Sku Other");
    const body = { name: "Mine", category: "X", priceCents: 1, sku: "AB-1" };
    expect((await world.client.send("POST", `${API}/items`, other.token, body)).status).toBe(201);
  });
});

describe("two calls at the same moment", () => {
  let world: World;
  let admin: string;

  beforeAll(async () => {
    world = await World.create();
    admin = await world.admin();
  });

  afterAll(async () => {
    await world.close();
  });

  test("approving twice tells the supplier once (review2 L2)", async () => {
    const waiting = await world.supplier("Race Waiting", false);
    const path = `${API}/companies/${waiting.user.companyId}/approve`;
    const calls = [];
    for (let index = 0; index < 4; index++) {
      calls.push(world.client.send("POST", path, admin));
    }
    expect(tally(await Promise.all(calls))).toEqual({ 200: 4 });
    const texts = await world.notes(waiting.token);
    expect(texts.filter((text) => text.startsWith("Your company is approved")).length).toBe(1);
    // Later calls change nothing, and the first date stays.
    const before = (await world.json("/company", waiting.token)).approvedAt;
    await world.client.send("POST", path, admin);
    expect((await world.json("/company", waiting.token)).approvedAt).toBe(before);
    expect((await world.notes(waiting.token)).length).toBe(texts.length);
  });

  test("a company that joins a group while the group is deleted gets a clean answer (review2 L3)", async () => {
    const statuses: Record<number, number> = {};
    for (let round = 0; round < 12; round++) {
      const company = await world.customer(`Joiner ${round}`);
      const created = await world.client.send("POST", `${API}/organizations`, admin, {
        name: `Race Gone ${round}`,
      });
      const id = (await created.json()).id;
      const pair = await Promise.all([
        world.client.send(
          "PUT",
          `${API}/organizations/${id}/companies/${company.user.companyId}`,
          admin,
        ),
        world.client.send("DELETE", `${API}/organizations/${id}`, admin),
      ]);
      for (const response of pair) {
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      }
      // Whatever won: the company is in no group that is gone.
      const mine = await world.json("/company", company.token);
      expect(mine.organization).toBeNull();
    }
    expect(statuses[500]).toBeUndefined();
    expect(statuses[204]).toBe(12);
  });

  test("the foreign key error of a deleted group becomes 404, not 500", async () => {
    // The moment of the race, made by hand: the group is gone when the company is saved.
    const company = await world.customer("Late Joiner");
    const created = await world.client.send("POST", `${API}/organizations`, admin, {
      name: "Soon Gone",
    });
    const id = (await created.json()).id;
    const service = world.context.organizationService;
    const real = service.get.bind(service);
    let calls = 0;
    service.get = async (groupId: string) => {
      const found = await real(groupId);
      // After the first check of `addCompany`, another admin deletes the group.
      if (++calls === 1) {
        await world.context.sql`DELETE FROM organizations WHERE id = ${groupId}`;
      }
      return found;
    };
    const response = await world.client.send(
      "PUT",
      `${API}/organizations/${id}/companies/${company.user.companyId}`,
      admin,
    );
    service.get = real;
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("Group not found.");
  });

  test("SQLite: a save of another request is not lost when a transaction rolls back (review2 L4)", async () => {
    const supplier = await world.supplier("Lost Supply");
    const customer = await world.customer("Lost Buyer");
    const item = await world.item(supplier.token, { stock: 100, priceCents: 1000 });
    const other = await world.item(supplier.token, { priceCents: 500 });
    for (let round = 1; round <= 5; round++) {
      const projectId = await world.project(customer.token, "2027-07-01", "2027-07-02");
      expect((await world.addLine(customer.token, projectId, item, 1)).status).toBe(201);
      // A send with a wrong total: its transaction runs some queries and then rolls back.
      const send = world.client.send("POST", `${API}/projects/${projectId}/send`, customer.token, {
        expectedTotalCents: 1,
      });
      // At the same moment the supplier changes the price of another item.
      const patch = world.client.send("PATCH", `${API}/items/${other}`, supplier.token, {
        priceCents: 700 + round,
      });
      const [sent, saved] = await Promise.all([send, patch]);
      expect(sent.status).toBe(409);
      expect(saved.status).toBe(200);
      // The answer said "saved", so it must be saved.
      expect((await world.json(`/items/${other}`, supplier.token)).priceCents).toBe(700 + round);
    }
  });
});
