import { SQL, type TransactionSQL } from "bun";
import { singleton } from "tsyringe";
import { ACTIVE_ORDER_STATUSES, ORDER_STATUSES, OrderStatus } from "../constants/order.constants";
import { Order, type OrderRow } from "../models/order.model";
import { OrderLine, type OrderLineRow } from "../models/order-line.model";
import type { Page, PageQuery } from "../schemas/page.schema";
import { searchSql } from "./search";

/** Every part is optional. An empty filter gives every order. */
export interface OrderFilter {
  supplierCompanyId?: string;
  customerCompanyId?: string;
  /** The orders where this company is the supplier or the customer. */
  eitherCompanyId?: string;
  projectId?: string;
  status?: OrderStatus;
  /** The search text: the number, the project and the names of both companies. */
  q?: string;
}

@singleton()
export class OrderRepository {
  constructor(private readonly sql: SQL) {}

  /** The newest order first. The lines are not loaded. No `page` gives every order. */
  async list(filter: OrderFilter, db: SQL = this.sql, page?: PageQuery): Promise<Order[]> {
    const rows = await this.select(db, this.where(filter, db), page);
    const orders: Order[] = [];
    for (const row of rows) {
      orders.push(Order.fromRow(row));
    }
    return orders;
  }

  /**
   * One page of orders, and the number of orders that match the filter.
   * `counts` has the orders per status for the same filter without its status, and
   * `totalCents`: the sum of the waiting, accepted and completed orders that match.
   */
  async listPage(filter: OrderFilter, page: PageQuery): Promise<Page<Order>> {
    const db = this.sql;
    const rows: { status: OrderStatus; count: number; total_cents: number }[] = await db`
      SELECT orders.status, COUNT(*) AS count, COALESCE(SUM(orders.total_cents), 0) AS total_cents
      FROM ${this.from(db)} ${this.where({ ...filter, status: undefined }, db)}
      GROUP BY orders.status
    `;
    const counts: Record<string, number> = { totalCents: 0 };
    for (const status of ORDER_STATUSES) {
      counts[status] = 0;
    }
    let total = 0;
    for (const row of rows) {
      // PostgreSQL returns a COUNT and a SUM as strings.
      counts[row.status] = Number(row.count);
      if (filter.status && filter.status !== row.status) {
        continue;
      }
      total += Number(row.count);
      if ((ACTIVE_ORDER_STATUSES as readonly string[]).includes(row.status)) {
        counts.totalCents = (counts.totalCents ?? 0) + Number(row.total_cents);
      }
    }
    return { rows: await this.list(filter, db, page), total, counts };
  }

  /** How many orders there are. The next order number is made from it. */
  async count(db: SQL): Promise<number> {
    const [row] = await db`SELECT COUNT(*) AS total FROM orders`;
    return Number(row.total);
  }

  /** One order with its lines. */
  async findById(id: string, db: SQL = this.sql): Promise<Order | null> {
    const rows = await this.select(db, db`WHERE orders.id = ${id}`);
    if (!rows[0]) {
      return null;
    }
    const order = Order.fromRow(rows[0]);
    await this.attachLines([order], db);
    return order;
  }

  /**
   * The insert runs in a savepoint. When it fails (the number is taken), the transaction
   * around it is still good and the caller can try again.
   */
  async create(order: Order, db: TransactionSQL): Promise<void> {
    await db.savepoint(this.insert.bind(this, order));
  }

  private async insert(order: Order, db: SQL): Promise<void> {
    // The order keeps its own copy of the event facts.
    const event = order.event;
    await db`
      INSERT INTO orders (
        id, number, project_id, customer_company_id, supplier_company_id, status, note,
        total_cents, created_at, project_name, venue, city, hall, booth_number,
        booth_width_cm, booth_depth_cm, starts_on, ends_on, setup_on, project_notes,
        created_by_admin_id, created_by_admin_name
      )
      VALUES (
        ${order.id}, ${order.number}, ${order.projectId}, ${order.customerCompanyId},
        ${order.supplierCompanyId}, ${order.status}, ${order.note}, ${order.totalCents},
        ${order.createdAt}, ${event.name}, ${event.venue}, ${event.city}, ${event.hall},
        ${event.boothNumber}, ${event.boothWidthCm}, ${event.boothDepthCm}, ${event.startsOn},
        ${event.endsOn}, ${event.setupOn}, ${event.notes},
        ${order.createdByAdminId}, ${order.createdByAdminName}
      )
    `;
  }

  async addLine(line: OrderLine, db: SQL): Promise<void> {
    await db`
      INSERT INTO order_lines (
        id, order_id, item_id, item_name, unit, unit_price_cents, quantity, line_total_cents,
        category, sku
      )
      VALUES (
        ${line.id}, ${line.orderId}, ${line.itemId}, ${line.itemName}, ${line.unit},
        ${line.unitPriceCents}, ${line.quantity}, ${line.lineTotalCents}, ${line.category},
        ${line.sku}
      )
    `;
  }

  /** Saves the fields that change after an order is made. */
  async update(order: Order, db: SQL): Promise<void> {
    await db`
      UPDATE orders SET status = ${order.status}, reject_reason = ${order.rejectReason},
        decided_at = ${order.decidedAt}, decided_by = ${order.decidedBy},
        completed_at = ${order.completedAt}, cancelled_by = ${order.cancelledBy}
      WHERE id = ${order.id}
    `;
  }

  async cancelPendingOfProject(projectId: string, db: SQL): Promise<void> {
    await db`
      UPDATE orders SET status = ${OrderStatus.Cancelled}, cancelled_by = 'customer'
      WHERE project_id = ${projectId} AND status = ${OrderStatus.Pending}
    `;
  }

  /** Loads the lines of all the orders in one query, not one query per order. */
  async attachLines(orders: Order[], db: SQL = this.sql): Promise<void> {
    if (orders.length === 0) {
      return;
    }
    const byId = new Map<string, Order>();
    for (const order of orders) {
      order.lines = [];
      byId.set(order.id, order);
    }
    const rows: OrderLineRow[] = await db`
      SELECT order_lines.*, items.stock,
        (SELECT file FROM item_photos WHERE item_photos.item_id = order_lines.item_id
          ORDER BY position, created_at, id LIMIT 1) AS photo_file
      FROM order_lines JOIN items ON items.id = order_lines.item_id
      WHERE order_lines.order_id IN ${db([...byId.keys()])}
      ORDER BY order_lines.item_name, order_lines.id
    `;
    for (const row of rows) {
      byId.get(row.order_id)?.lines.push(OrderLine.fromRow(row));
    }
  }

  /** The tables that a filter needs. */
  private from(db: SQL): SQL.Query<unknown> {
    return db`orders
      JOIN companies customers ON customers.id = orders.customer_company_id
      JOIN companies suppliers ON suppliers.id = orders.supplier_company_id`;
  }

  private where(filter: OrderFilter, db: SQL): SQL.Query<unknown> {
    const supplier = filter.supplierCompanyId
      ? db`AND orders.supplier_company_id = ${filter.supplierCompanyId}`
      : db``;
    const customer = filter.customerCompanyId
      ? db`AND orders.customer_company_id = ${filter.customerCompanyId}`
      : db``;
    const either = filter.eitherCompanyId
      ? db`AND (orders.supplier_company_id = ${filter.eitherCompanyId}
          OR orders.customer_company_id = ${filter.eitherCompanyId})`
      : db``;
    const project = filter.projectId ? db`AND orders.project_id = ${filter.projectId}` : db``;
    const status = filter.status ? db`AND orders.status = ${filter.status}` : db``;
    const search = searchSql(db, filter.q, [
      db`orders.number`,
      db`orders.project_name`,
      db`customers.name`,
      db`suppliers.name`,
    ]);
    return db`WHERE 1 = 1 ${supplier} ${customer} ${either} ${project} ${status} ${search}`;
  }

  private select(db: SQL, where: SQL.Query<unknown>, page?: PageQuery): Promise<OrderRow[]> {
    const limit = page ? db`LIMIT ${page.limit} OFFSET ${page.offset}` : db``;
    return db`
      SELECT orders.*, customers.name AS customer_company_name,
        customers.phone AS customer_phone, suppliers.name AS supplier_company_name,
        suppliers.phone AS supplier_phone,
        customer_owner.email AS customer_contact_email,
        customer_owner.name AS customer_contact_name,
        supplier_owner.email AS supplier_contact_email,
        supplier_owner.name AS supplier_contact_name,
        (SELECT COUNT(*) FROM order_lines WHERE order_lines.order_id = orders.id) AS line_count
      FROM ${this.from(db)}
      LEFT JOIN users customer_owner ON customer_owner.company_id = orders.customer_company_id
        AND customer_owner.is_owner = 1
      LEFT JOIN users supplier_owner ON supplier_owner.company_id = orders.supplier_company_id
        AND supplier_owner.is_owner = 1
      ${where}
      ORDER BY orders.created_at DESC, orders.number
      ${limit}
    `;
  }
}
