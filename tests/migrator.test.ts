import { expect, test } from "bun:test";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SQL } from "bun";
import { MIGRATIONS_DIR, Migrator } from "../database/migrator";
import { openDatabase } from "../database/open-database";

test("every statement of a migration file runs, also after an ALTER TABLE", async () => {
  const dir = await mkdtemp(`${tmpdir()}/migrations-`);
  await Bun.write(`${dir}/001_create.sql`, "CREATE TABLE notes (id TEXT);");
  await Bun.write(
    `${dir}/002_change.sql`,
    "-- Add a column; then fill it.\nALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0;\nUPDATE notes SET done = 1;\nCREATE INDEX notes_done_index ON notes (done);",
  );
  const sql = new SQL(":memory:");
  const migrator = new Migrator(sql, dir);

  expect(await migrator.run()).toEqual(["001_create.sql", "002_change.sql"]);
  const indexes = await sql`SELECT name FROM sqlite_master WHERE name = 'notes_done_index'`;
  expect(indexes.length).toBe(1);
  expect(await migrator.run()).toEqual([]);
});

test("the one photo of an old item becomes its first photo", async () => {
  const dir = await mkdtemp(`${tmpdir()}/migrations-`);
  const files = await Array.fromAsync(new Bun.Glob("*.sql").scan(MIGRATIONS_DIR));
  files.sort();
  // The database as it was before items could have many photos.
  for (const name of files.slice(0, 8)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  const sql = new SQL(":memory:");
  const migrator = new Migrator(sql, dir);
  expect((await migrator.run()).at(-1)).toBe("008_set_company_owners.sql");
  const now = new Date().toISOString();
  await sql`INSERT INTO companies (id, name, type, created_at) VALUES ('c1', 'Old Co', 'supplier', ${now})`;
  await sql`
    INSERT INTO items (id, company_id, name, category, price_cents, photo, created_at)
    VALUES ('with', 'c1', 'Old chair', 'Furniture', 100, 'old.jpg', ${now}),
      ('without', 'c1', 'Old table', 'Furniture', 200, NULL, ${now})
  `;

  for (const name of files.slice(8)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  expect(await migrator.run()).toEqual(files.slice(8));

  const photos = await sql`SELECT id, item_id, file, position FROM item_photos`;
  expect([...photos]).toEqual([{ id: "with", item_id: "with", file: "old.jpg", position: 0 }]);
  const items = await sql`SELECT * FROM items ORDER BY id`;
  expect(items.length).toBe(2);
  expect(items[0].photo).toBeUndefined();
  expect(items[0]).toMatchObject({ name: "Old chair", unit: "piece", sku: null, stock: null });
});

test("an order from before the event copy gets the facts of its project", async () => {
  const dir = await mkdtemp(`${tmpdir()}/migrations-`);
  const files = await Array.fromAsync(new Bun.Glob("*.sql").scan(MIGRATIONS_DIR));
  files.sort();
  // The database as it was when an order read its project on every request.
  for (const name of files.slice(0, 16)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  const sql = new SQL(":memory:");
  const migrator = new Migrator(sql, dir);
  expect((await migrator.run()).at(-1)).toBe("016_add_category_to_order_lines.sql");
  const now = new Date().toISOString();
  await sql`
    INSERT INTO companies (id, name, type, created_at)
    VALUES ('buyer', 'Buyer', 'customer', ${now}), ('seller', 'Seller', 'supplier', ${now})
  `;
  await sql`
    INSERT INTO projects (
      id, company_id, name, venue, city, hall, booth_number, booth_width_cm, starts_on, ends_on,
      setup_on, notes, created_at
    )
    VALUES
      ('p1', 'buyer', 'Old Fair', 'Expo', 'Yangon', 'A', 'A-1', 600, '2026-11-20', '2026-11-23',
        '2026-11-18', 'Gate 2', ${now}),
      ('p2', 'buyer', 'Plain Fair', '', '', '', '', NULL, '2026-12-01', '2026-12-02', NULL, '', ${now})
  `;
  await sql`
    INSERT INTO orders (id, number, project_id, customer_company_id, supplier_company_id,
      status, total_cents, created_at)
    VALUES ('o1', 'ORD-1', 'p1', 'buyer', 'seller', 'accepted', 100, ${now}),
      ('o2', 'ORD-2', 'p2', 'buyer', 'seller', 'pending', 200, ${now})
  `;

  for (const name of files.slice(16)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  expect(await migrator.run()).toEqual(files.slice(16));

  const orders = await sql`SELECT * FROM orders ORDER BY id`;
  expect(orders[0]).toMatchObject({
    status: "accepted",
    total_cents: 100,
    project_name: "Old Fair",
    venue: "Expo",
    city: "Yangon",
    hall: "A",
    booth_number: "A-1",
    booth_width_cm: 600,
    booth_depth_cm: null,
    starts_on: "2026-11-20",
    ends_on: "2026-11-23",
    setup_on: "2026-11-18",
    project_notes: "Gate 2",
  });
  expect(orders[1]).toMatchObject({
    project_name: "Plain Fair",
    starts_on: "2026-12-01",
    ends_on: "2026-12-02",
    setup_on: null,
    venue: "",
  });
});

test("companies with the same name keep their data, and the name index is made", async () => {
  const dir = await mkdtemp(`${tmpdir()}/migrations-`);
  const files = await Array.fromAsync(new Bun.Glob("*.sql").scan(MIGRATIONS_DIR));
  files.sort();
  // The database as it was when two companies could have the same name.
  for (const name of files.slice(0, 17)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  // This one also runs on PostgreSQL, because the index must work on both databases.
  const url = Bun.env.TEST_DATABASE_URL;
  const sql = await openDatabase(url ?? ":memory:");
  if (url) {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  }
  const migrator = new Migrator(sql, dir);
  expect((await migrator.run()).at(-1)).toBe("017_add_event_copy_to_orders.sql");
  await sql`
    INSERT INTO companies (id, name, type, created_at)
    VALUES ('a', 'Acme', 'supplier', '2026-01-01T00:00:00.000Z'),
      ('b', ' ACME ', 'customer', '2026-02-01T00:00:00.000Z'),
      ('c', 'acme', 'supplier', '2026-02-01T00:00:00.000Z'),
      ('d', 'Other', 'customer', '2026-03-01T00:00:00.000Z')
  `;

  for (const name of files.slice(17)) {
    await copyFile(`${MIGRATIONS_DIR}/${name}`, `${dir}/${name}`);
  }
  expect(await migrator.run()).toEqual(files.slice(17));

  const rows = await sql`SELECT id, name, name_key, approved_at FROM companies ORDER BY id`;
  // The oldest keeps the key. The later ones get their id at the end. No name changes.
  expect([...rows].map((row) => [row.id, row.name, row.name_key])).toEqual([
    ["a", "Acme", "acme"],
    ["b", " ACME ", "acme #b"],
    ["c", "acme", "acme #c"],
    ["d", "Other", "other"],
  ]);
  // Every company that was there before is approved, also the suppliers.
  expect(rows.every((row: { approved_at: string | null }) => row.approved_at !== null)).toBe(true);
  // From now on the database refuses a name key that is taken.
  let refused = false;
  try {
    await sql`
      INSERT INTO companies (id, name, name_key, type, created_at)
      VALUES ('e', 'OTHER', 'other', 'customer', '2026-04-01T00:00:00.000Z')
    `;
  } catch {
    refused = true;
  }
  expect(refused).toBe(true);
  await sql.close();
});
