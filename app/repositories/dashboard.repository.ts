import { SQL } from "bun";
import { singleton } from "tsyringe";
import { ACTIVE_ORDER_STATUSES, OrderStatus } from "../constants/order.constants";
import { Role } from "../constants/role.constants";
import { UPLOADS_URL } from "../constants/upload.constants";
import { Company, type CompanyRow } from "../models/company.model";

/** The side of the orders to count. An empty filter counts the orders of every company. */
export interface OrderSide {
  supplierCompanyId?: string;
  customerCompanyId?: string;
}

/** The orders of one status: how many, and the sum of their totals. */
export interface OrderTotals {
  count: number;
  totalCents: number;
}

export interface TopItem {
  itemId: string;
  itemName: string;
  category: string;
  /** The cover photo of the item. */
  photoUrl: string | null;
  /** The accepted and completed orders that hold the item. */
  orderCount: number;
  quantity: number;
  revenueCents: number;
}

/** The counts and sums of the dashboard. PostgreSQL returns them as strings, so `Number()`. */
@singleton()
export class DashboardRepository {
  constructor(private readonly sql: SQL) {}

  /** One entry per order status that has orders. */
  async orderTotals(side: OrderSide): Promise<Map<OrderStatus, OrderTotals>> {
    const db = this.sql;
    const supplier = side.supplierCompanyId
      ? db`AND supplier_company_id = ${side.supplierCompanyId}`
      : db``;
    const customer = side.customerCompanyId
      ? db`AND customer_company_id = ${side.customerCompanyId}`
      : db``;
    const rows: { status: OrderStatus; count: number; total_cents: number }[] = await db`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
      FROM orders WHERE 1 = 1 ${supplier} ${customer}
      GROUP BY status
    `;
    const totals = new Map<OrderStatus, OrderTotals>();
    for (const row of rows) {
      totals.set(row.status, { count: Number(row.count), totalCents: Number(row.total_cents) });
    }
    return totals;
  }

  /** The items of the company that are not hidden. */
  async countListedItems(companyId: string): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM items WHERE company_id = ${companyId} AND hidden_at IS NULL
    `;
    return Number(row.total);
  }

  async countHiddenItems(companyId: string): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM items
      WHERE company_id = ${companyId} AND hidden_at IS NOT NULL
    `;
    return Number(row.total);
  }

  /**
   * How many orders the supplier got per month, from `firstMonth` ("YYYY-MM") on.
   * A rejected or cancelled order is not counted.
   * `created_at` is an ISO string, so its first 7 characters are the month.
   * A month with no orders is not in the map.
   */
  async ordersPerMonth(
    supplierCompanyId: string,
    firstMonth: string,
  ): Promise<Map<string, number>> {
    const rows: { month: string; count: number }[] = await this.sql`
      SELECT SUBSTR(created_at, 1, 7) AS month, COUNT(*) AS count
      FROM orders
      WHERE supplier_company_id = ${supplierCompanyId} AND created_at >= ${firstMonth}
        AND status IN ${this.sql([...ACTIVE_ORDER_STATUSES])}
      GROUP BY SUBSTR(created_at, 1, 7)
    `;
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.month, Number(row.count));
    }
    return counts;
  }

  /** The items with the biggest ordered quantity in accepted and completed orders. */
  async topItems(supplierCompanyId: string, limit: number): Promise<TopItem[]> {
    const rows: {
      item_id: string;
      item_name: string;
      category: string;
      photo_file: string | null;
      order_count: number;
      quantity: number;
      revenue_cents: number;
    }[] = await this.sql`
        SELECT order_lines.item_id, items.name AS item_name, items.category,
          (SELECT file FROM item_photos WHERE item_photos.item_id = order_lines.item_id
            ORDER BY position, created_at, id LIMIT 1) AS photo_file,
          COUNT(DISTINCT orders.id) AS order_count,
          SUM(order_lines.quantity) AS quantity,
          SUM(order_lines.line_total_cents) AS revenue_cents
        FROM order_lines
        JOIN orders ON orders.id = order_lines.order_id
        JOIN items ON items.id = order_lines.item_id
        WHERE orders.supplier_company_id = ${supplierCompanyId}
          AND orders.status IN (${OrderStatus.Accepted}, ${OrderStatus.Completed})
        GROUP BY order_lines.item_id, items.name, items.category
        ORDER BY SUM(order_lines.quantity) DESC, items.name, order_lines.item_id
        LIMIT ${limit}
      `;
    const items: TopItem[] = [];
    for (const row of rows) {
      items.push({
        itemId: row.item_id,
        itemName: row.item_name,
        category: row.category,
        photoUrl: row.photo_file ? `${UPLOADS_URL}/${row.photo_file}` : null,
        orderCount: Number(row.order_count),
        quantity: Number(row.quantity),
        revenueCents: Number(row.revenue_cents),
      });
    }
    return items;
  }

  /** How many companies there are of each type. */
  async companyCounts(): Promise<Map<Role, number>> {
    const rows: { type: Role; count: number }[] = await this.sql`
      SELECT type, COUNT(*) AS count FROM companies GROUP BY type
    `;
    const counts = new Map<Role, number>();
    for (const row of rows) {
      counts.set(row.type, Number(row.count));
    }
    return counts;
  }

  /** The suppliers that signed up by themselves and still wait for an admin. */
  async countSuppliersWaiting(): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM companies
      WHERE type = ${Role.Supplier} AND approved_at IS NULL
    `;
    return Number(row.total);
  }

  /** The customer companies that an admin turned off. */
  async countDisabledCustomers(): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM companies
      WHERE type = ${Role.Customer} AND disabled_at IS NOT NULL
    `;
    return Number(row.total);
  }

  /** The customer and supplier companies that signed up last, with the name of their owner. */
  async newestCompanies(limit: number): Promise<{ company: Company; ownerName: string | null }[]> {
    const rows: (CompanyRow & { owner_name: string | null })[] = await this.sql`
      SELECT companies.*,
        (SELECT MIN(users.name) FROM users
          WHERE users.company_id = companies.id AND users.is_owner = 1) AS owner_name
      FROM companies WHERE type <> ${Role.Admin}
      ORDER BY created_at DESC, id LIMIT ${limit}
    `;
    const companies = [];
    for (const row of rows) {
      companies.push({ company: Company.fromRow(row), ownerName: row.owner_name });
    }
    return companies;
  }
}
