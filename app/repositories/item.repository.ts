import { SQL } from "bun";
import { singleton } from "tsyringe";
import { ACTIVE_ORDER_STATUSES, OrderStatus } from "../constants/order.constants";
import { Role } from "../constants/role.constants";
import { Item, type ItemRow } from "../models/item.model";
import { ItemPhoto, type ItemPhotoRow } from "../models/item-photo.model";
import type { UpdateItemInput } from "../schemas/item.schema";
import type { Page, PageQuery } from "../schemas/page.schema";
import { type Booking, busiestDay } from "../services/bookings";
import { searchSql } from "./search";

/** What a list of items can be narrowed by. `q` of the page is the search text. */
export interface ItemFilter {
  category?: string;
  /** In a catalog: the items of suppliers, of my organization group, or my own. */
  owner?: "supplier" | "shared" | "own";
}

/** How many distinct categories a list of categories has at most. */
const MAX_CATEGORIES = 200;

/** The column that each input field is saved in. */
const COLUMN_OF: Record<keyof UpdateItemInput, string> = {
  name: "name",
  category: "category",
  description: "description",
  priceCents: "price_cents",
  sku: "sku",
  unit: "unit",
  widthCm: "width_cm",
  heightCm: "height_cm",
  depthCm: "depth_cm",
  weightKg: "weight_grams",
  color: "color",
  material: "material",
  stock: "stock",
  hidden: "hidden_at",
};

@singleton()
export class ItemRepository {
  constructor(private readonly sql: SQL) {}

  /** Every item of every company. */
  listAll(page: PageQuery): Promise<Page<Item>> {
    return this.list(this.sql`WHERE 1 = 1 ${this.matches(page, {})}`, page);
  }

  /** The items of one company. Hidden ones too. `counts.hidden` is how many are hidden. */
  async listByCompany(
    companyId: string,
    page: PageQuery,
    filter: ItemFilter = {},
  ): Promise<Page<Item>> {
    const where = this.sql`WHERE items.company_id = ${companyId} ${this.matches(page, filter)}`;
    const result = await this.list(where, page);
    await this.attachOrderCounts(result.rows);
    const [hidden] = await this.sql`
      SELECT COUNT(*) AS total
      FROM items JOIN companies ON companies.id = items.company_id
      ${where} AND items.hidden_at IS NOT NULL
    `;
    // PostgreSQL returns a COUNT as a string.
    result.counts = { hidden: Number(hidden.total) };
    return result;
  }

  /** The search text and the category of a list. */
  private matches(page: PageQuery, filter: ItemFilter): SQL.Query<unknown> {
    const db = this.sql;
    const category = filter.category ? db`AND items.category = ${filter.category}` : db``;
    const search = searchSql(db, page.q, [
      db`items.name`,
      db`items.category`,
      db`items.sku`,
      db`items.description`,
      db`companies.name`,
    ]);
    return db`${category} ${search}`;
  }

  /**
   * The one rule of the catalog of a customer company. The list and the single item both
   * use it, so they always agree. An item is in the catalog when it is not hidden, its
   * owner is not disabled, and one of these is true:
   * - the owner is a supplier that an admin approved, or the admin company
   * - the owner is the customer company itself
   * - the owner is another company of the same organization group (a shared item)
   * A customer never gets the item of a customer outside its group.
   */
  private inCatalog(customerCompanyId: string, db: SQL): SQL.Query<unknown> {
    // A company in no group has NULL here. NULL equals nothing, so nothing is shared.
    const myGroup = db`SELECT organization_id FROM companies WHERE id = ${customerCompanyId}`;
    return db`
      items.hidden_at IS NULL
      AND companies.disabled_at IS NULL
      AND (
        (companies.type <> ${Role.Customer} AND companies.approved_at IS NOT NULL)
        OR items.company_id = ${customerCompanyId}
        OR (companies.type = ${Role.Customer} AND companies.organization_id = (${myGroup}))
      )
    `;
  }

  /** The items a customer company can add to a project. See `inCatalog`. */
  listCatalog(
    customerCompanyId: string,
    page: PageQuery,
    filter: ItemFilter = {},
  ): Promise<Page<Item>> {
    const db = this.sql;
    let owner = db``;
    if (filter.owner === "own") {
      owner = db`AND items.company_id = ${customerCompanyId}`;
    } else if (filter.owner === "shared") {
      owner = db`AND companies.type = ${Role.Customer} AND items.company_id <> ${customerCompanyId}`;
    } else if (filter.owner === "supplier") {
      owner = db`AND companies.type <> ${Role.Customer}`;
    }
    return this.list(
      db`WHERE ${this.inCatalog(customerCompanyId, db)} ${owner} ${this.matches(page, filter)}`,
      page,
    );
  }

  /** The categories of my items, or of my catalog, sorted. For the filter of a list. */
  async categories(companyId: string, catalog: boolean): Promise<string[]> {
    const db = this.sql;
    const where = catalog
      ? db`WHERE ${this.inCatalog(companyId, db)}`
      : db`WHERE items.company_id = ${companyId}`;
    const rows: { category: string }[] = await db`
      SELECT DISTINCT items.category
      FROM items JOIN companies ON companies.id = items.company_id
      ${where}
      ORDER BY items.category LIMIT ${MAX_CATEGORIES}
    `;
    const names: string[] = [];
    for (const row of rows) {
      names.push(row.category);
    }
    return names;
  }

  /** One item of the catalog of a customer company. See `inCatalog`. */
  async findInCatalog(
    customerCompanyId: string,
    id: string,
    db: SQL = this.sql,
  ): Promise<Item | null> {
    const rows: ItemRow[] = await db`
      SELECT items.*, companies.name AS company_name, companies.type AS company_type,
        companies.phone AS company_phone, companies.website AS company_website,
        companies.about AS company_about
      FROM items JOIN companies ON companies.id = items.company_id
      WHERE items.id = ${id} AND ${this.inCatalog(customerCompanyId, db)}
    `;
    return (await this.toItems(rows, db))[0] ?? null;
  }

  async findById(id: string): Promise<Item | null> {
    const rows: ItemRow[] = await this.sql`
      SELECT items.*, companies.name AS company_name, companies.type AS company_type,
        companies.phone AS company_phone, companies.website AS company_website,
        companies.about AS company_about
      FROM items JOIN companies ON companies.id = items.company_id
      WHERE items.id = ${id}
    `;
    return (await this.toItems(rows))[0] ?? null;
  }

  /** The id of the item of this company that has this SKU. */
  async findIdBySku(companyId: string, sku: string): Promise<string | null> {
    const rows: { id: string }[] = await this.sql`
      SELECT id FROM items WHERE company_id = ${companyId} AND LOWER(sku) = LOWER(${sku})
    `;
    return rows[0]?.id ?? null;
  }

  async create(item: Item): Promise<void> {
    await this.sql`
      INSERT INTO items (
        id, company_id, name, category, description, price_cents, hidden_at, created_at,
        sku, unit, width_cm, height_cm, depth_cm, weight_grams, color, material, stock
      )
      VALUES (
        ${item.id}, ${item.companyId}, ${item.name}, ${item.category}, ${item.description},
        ${item.priceCents}, ${item.hiddenAt}, ${item.createdAt},
        ${item.sku}, ${item.unit}, ${item.widthCm}, ${item.heightCm}, ${item.depthCm},
        ${item.weightGrams}, ${item.color}, ${item.material}, ${item.stock}
      )
    `;
  }

  /**
   * Saves only the given fields of the item. Every other column stays as it is in the
   * database, so two changes of different fields at the same moment do not undo each other.
   */
  async update(item: Item, fields: readonly (keyof UpdateItemInput)[]): Promise<void> {
    const row = {
      name: item.name,
      category: item.category,
      description: item.description,
      price_cents: item.priceCents,
      sku: item.sku,
      unit: item.unit,
      width_cm: item.widthCm,
      height_cm: item.heightCm,
      depth_cm: item.depthCm,
      weight_grams: item.weightGrams,
      color: item.color,
      material: item.material,
      stock: item.stock,
      hidden_at: item.hiddenAt,
    };
    const columns: (keyof typeof row)[] = [];
    for (const field of fields) {
      columns.push(COLUMN_OF[field] as keyof typeof row);
    }
    if (columns.length === 0) {
      return;
    }
    await this.sql`UPDATE items SET ${this.sql(row, ...columns)} WHERE id = ${item.id}`;
  }

  async countByCompany(companyId: string): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM items WHERE company_id = ${companyId}
    `;
    // PostgreSQL returns a COUNT as a string.
    return Number(row.total);
  }

  /**
   * Locks the item rows until the transaction ends. Two accepts that take the same item
   * then run one after the other, so both cannot pass the availability check.
   * The ids are locked in a fixed order, so two transactions never wait for each other.
   */
  async lock(ids: readonly string[], db: SQL): Promise<void> {
    for (const id of [...new Set(ids)].sort()) {
      // An UPDATE that changes nothing. It takes the row lock on both databases.
      await db`UPDATE items SET id = id WHERE id = ${id}`;
    }
  }

  /**
   * How many of each item are taken from `from` to `to` (YYYY-MM-DD, both days count):
   * the highest total of one single day. An accepted or completed order holds its items
   * from its setup day (or its first day) to its last day. An item with no such order is
   * not in the result.
   */
  async reserved(
    ids: readonly string[],
    from: string,
    to: string,
    db: SQL = this.sql,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [itemId, bookings] of await this.bookings(ids, from, to, db)) {
      result.set(itemId, busiestDay(bookings, from, to));
    }
    return result;
  }

  /**
   * The accepted and completed orders that hold these items on a day from `from` on.
   * With `to`, only up to that day. One list per item.
   */
  async bookings(
    ids: readonly string[],
    from: string,
    to: string | null,
    db: SQL = this.sql,
  ): Promise<Map<string, Booking[]>> {
    const result = new Map<string, Booking[]>();
    if (ids.length === 0) {
      return result;
    }
    const until = to === null ? db`` : db`AND COALESCE(orders.setup_on, orders.starts_on) <= ${to}`;
    const rows: { item_id: string; starts: string; ends: string; quantity: number }[] = await db`
      SELECT order_lines.item_id, COALESCE(orders.setup_on, orders.starts_on) AS starts,
        orders.ends_on AS ends, order_lines.quantity
      FROM order_lines JOIN orders ON orders.id = order_lines.order_id
      WHERE order_lines.item_id IN ${db([...new Set(ids)])}
        AND orders.status IN (${OrderStatus.Accepted}, ${OrderStatus.Completed})
        AND orders.ends_on >= ${from} ${until}
    `;
    for (const row of rows) {
      const list = result.get(row.item_id) ?? [];
      // PostgreSQL can return an INTEGER as a string.
      list.push({
        itemId: row.item_id,
        from: row.starts,
        to: row.ends,
        quantity: Number(row.quantity),
      });
      result.set(row.item_id, list);
    }
    return result;
  }

  async addPhoto(photo: ItemPhoto): Promise<void> {
    await this.sql`
      INSERT INTO item_photos (id, item_id, file, position, created_at)
      VALUES (${photo.id}, ${photo.itemId}, ${photo.file}, ${photo.position}, ${photo.createdAt})
    `;
  }

  async removePhoto(id: string): Promise<void> {
    await this.sql`DELETE FROM item_photos WHERE id = ${id}`;
  }

  async setPhotoPosition(id: string, position: number): Promise<void> {
    await this.sql`UPDATE item_photos SET position = ${position} WHERE id = ${id}`;
  }

  /** One page of items, sorted by name, and the number of items that match. */
  private async list(where: SQL.Query<unknown>, page: PageQuery): Promise<Page<Item>> {
    const rows: ItemRow[] = await this.sql`
      SELECT items.*, companies.name AS company_name, companies.type AS company_type
      FROM items JOIN companies ON companies.id = items.company_id
      ${where}
      ORDER BY items.name, items.id
      LIMIT ${page.limit} OFFSET ${page.offset}
    `;
    const [count] = await this.sql`
      SELECT COUNT(*) AS total
      FROM items JOIN companies ON companies.id = items.company_id
      ${where}
    `;
    // PostgreSQL returns a COUNT as a string.
    return { rows: await this.toItems(rows), total: Number(count.total) };
  }

  private async toItems(rows: ItemRow[], db: SQL = this.sql): Promise<Item[]> {
    const items: Item[] = [];
    for (const row of rows) {
      items.push(Item.fromRow(row));
    }
    await this.attachPhotos(items, db);
    return items;
  }

  /**
   * Counts the orders of all the items in one query: the waiting, accepted and completed
   * ones. A rejected or cancelled order is not counted.
   */
  private async attachOrderCounts(items: Item[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const byId = new Map<string, Item>();
    for (const item of items) {
      byId.set(item.id, item);
    }
    const rows: { item_id: string; count: number }[] = await this.sql`
      SELECT order_lines.item_id, COUNT(DISTINCT order_lines.order_id) AS count
      FROM order_lines
      JOIN orders ON orders.id = order_lines.order_id
      WHERE order_lines.item_id IN ${this.sql([...byId.keys()])}
        AND orders.status IN ${this.sql([...ACTIVE_ORDER_STATUSES])}
      GROUP BY order_lines.item_id
    `;
    for (const row of rows) {
      const item = byId.get(row.item_id);
      if (item) {
        // PostgreSQL returns a COUNT as a string.
        item.orderCount = Number(row.count);
      }
    }
  }

  /** Loads the photos of all the items in one query, not one query per item. */
  private async attachPhotos(items: Item[], db: SQL): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const byId = new Map<string, Item>();
    for (const item of items) {
      byId.set(item.id, item);
    }
    const rows: ItemPhotoRow[] = await db`
      SELECT * FROM item_photos WHERE item_id IN ${db([...byId.keys()])}
      ORDER BY position, created_at, id
    `;
    for (const row of rows) {
      byId.get(row.item_id)?.photos.push(ItemPhoto.fromRow(row));
    }
  }
}
