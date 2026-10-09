import { SQL, type TransactionSQL } from "bun";
import { singleton } from "tsyringe";
import { OrderStatus } from "../constants/order.constants";
import { PROJECT_STATUSES, ProjectSort, type ProjectStatus } from "../constants/project.constants";
import { Project, type ProjectRow } from "../models/project.model";
import { ProjectLine, type ProjectLineRow } from "../models/project-line.model";
import type { Page, PageQuery } from "../schemas/page.schema";
import { searchSql } from "./search";
import { TransactionRunner } from "./transaction-runner";

/** The work that runs inside a transaction. It uses `db` for every query. */
export type LockedWork<T> = (db: TransactionSQL) => Promise<T>;

/** Every part is optional. An empty filter gives every project. */
export interface ProjectFilter {
  companyId?: string;
  statuses?: readonly ProjectStatus[];
  sort?: ProjectSort;
  /** Only projects that end on this day (YYYY-MM-DD) or later. */
  endsOnOrAfter?: string;
  /** The search text: the name, the place and the customer. */
  q?: string;
  /** Only projects with an order that waits for an answer. */
  hasWaitingOrders?: boolean;
  /** For the sort `next`: the day (YYYY-MM-DD) that splits the events to come from the past ones. */
  today?: string;
}

@singleton()
export class ProjectRepository {
  constructor(
    private readonly sql: SQL,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Runs the work in one transaction and locks the project row first.
   * Two changes of one project (or of its orders) then never run at the same moment,
   * and a failure leaves nothing half-done.
   */
  locked<T>(projectId: string, work: LockedWork<T>): Promise<T> {
    return this.transactions.run(this.lockThenWork.bind(this, projectId, work)) as Promise<T>;
  }

  private async lockThenWork<T>(
    projectId: string,
    work: LockedWork<T>,
    tx: TransactionSQL,
  ): Promise<T> {
    // An UPDATE that changes nothing. It takes the row lock on both databases.
    await tx`UPDATE projects SET id = id WHERE id = ${projectId}`;
    return work(tx);
  }

  /**
   * One page of projects, and the number of projects that match the filter.
   * `counts` has the projects per status for the same filter without its statuses, and
   * `totalCents`: the sum of the order totals of the projects that match.
   */
  async list(filter: ProjectFilter, page: PageQuery): Promise<Page<Project>> {
    const db = this.sql;
    const rows = await this.select(db, this.where(filter), filter, page);
    const projects: Project[] = [];
    for (const row of rows) {
      projects.push(Project.fromRow(row));
    }
    const active = db`orders.status IN (${OrderStatus.Pending}, ${OrderStatus.Accepted}, ${OrderStatus.Completed})`;
    const groups: { status: ProjectStatus; count: number; total_cents: number }[] = await db`
      SELECT found.status, COUNT(*) AS count, COALESCE(SUM(found.total_cents), 0) AS total_cents
      FROM (
        SELECT ${this.statusSql(db)} AS status,
          (SELECT COALESCE(SUM(orders.total_cents), 0) FROM orders
            WHERE orders.project_id = projects.id AND ${active}) AS total_cents
        FROM projects JOIN companies ON companies.id = projects.company_id
        ${this.where({ ...filter, statuses: undefined })}
      ) found
      GROUP BY found.status
    `;
    const counts: Record<string, number> = { totalCents: 0 };
    for (const status of PROJECT_STATUSES) {
      counts[status] = 0;
    }
    let total = 0;
    for (const group of groups) {
      // PostgreSQL returns a COUNT and a SUM as strings.
      counts[group.status] = Number(group.count);
      if (!filter.statuses || filter.statuses.includes(group.status)) {
        total += Number(group.count);
        counts.totalCents = (counts.totalCents ?? 0) + Number(group.total_cents);
      }
    }
    return { rows: projects, total, counts };
  }

  async count(filter: ProjectFilter): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total
      FROM projects JOIN companies ON companies.id = projects.company_id
      ${this.where(filter)}
    `;
    // PostgreSQL returns a COUNT as a string.
    return Number(row.total);
  }

  async findById(id: string, db: SQL = this.sql): Promise<Project | null> {
    const rows = await this.select(db, db`WHERE projects.id = ${id}`);
    return rows[0] ? Project.fromRow(rows[0]) : null;
  }

  async create(project: Project): Promise<void> {
    await this.sql`
      INSERT INTO projects (
        id, company_id, name, venue, city, hall, booth_number, booth_width_cm, booth_depth_cm,
        starts_on, ends_on, setup_on, notes, created_by, created_at,
        created_by_admin_id, created_by_admin_name
      )
      VALUES (
        ${project.id}, ${project.companyId}, ${project.name}, ${project.venue}, ${project.city},
        ${project.hall}, ${project.boothNumber}, ${project.boothWidthCm}, ${project.boothDepthCm},
        ${project.startsOn}, ${project.endsOn}, ${project.setupOn}, ${project.notes},
        ${project.createdBy}, ${project.createdAt},
        ${project.createdByAdminId}, ${project.createdByAdminName}
      )
    `;
  }

  /** Saves the fields of the event. `cancelled_at` and `done_at` have their own methods. */
  async update(project: Project, db: SQL): Promise<void> {
    await db`
      UPDATE projects SET name = ${project.name}, venue = ${project.venue}, city = ${project.city},
        hall = ${project.hall}, booth_number = ${project.boothNumber},
        booth_width_cm = ${project.boothWidthCm}, booth_depth_cm = ${project.boothDepthCm},
        starts_on = ${project.startsOn}, ends_on = ${project.endsOn},
        setup_on = ${project.setupOn}, notes = ${project.notes}
      WHERE id = ${project.id}
    `;
  }

  async setCancelled(id: string, at: string, db: SQL): Promise<void> {
    await db`UPDATE projects SET cancelled_at = ${at} WHERE id = ${id}`;
  }

  async setDone(id: string, at: string, db: SQL): Promise<void> {
    await db`UPDATE projects SET done_at = ${at} WHERE id = ${id}`;
  }

  /** The lines of a project, in the order they were added. */
  async listLines(projectId: string, db: SQL = this.sql): Promise<ProjectLine[]> {
    const rows = await this.selectLines(db, db`WHERE project_lines.project_id = ${projectId}`);
    const lines: ProjectLine[] = [];
    for (const row of rows) {
      lines.push(ProjectLine.fromRow(row));
    }
    return lines;
  }

  async findLine(projectId: string, lineId: string, db: SQL): Promise<ProjectLine | null> {
    const rows = await this.selectLines(
      db,
      db`WHERE project_lines.project_id = ${projectId} AND project_lines.id = ${lineId}`,
    );
    return rows[0] ? ProjectLine.fromRow(rows[0]) : null;
  }

  /** The line of this item that is not in an order yet. A project has at most one. */
  async findOpenLine(projectId: string, itemId: string, db: SQL): Promise<ProjectLine | null> {
    const rows = await this.selectLines(
      db,
      db`WHERE project_lines.project_id = ${projectId} AND project_lines.item_id = ${itemId}
        AND project_lines.order_id IS NULL`,
    );
    return rows[0] ? ProjectLine.fromRow(rows[0]) : null;
  }

  async addLine(projectId: string, itemId: string, quantity: number, db: SQL): Promise<void> {
    await db`
      INSERT INTO project_lines (id, project_id, item_id, quantity, created_at, position)
      VALUES (${crypto.randomUUID()}, ${projectId}, ${itemId}, ${quantity},
        ${new Date().toISOString()},
        (SELECT COALESCE(MAX(position), 0) + 1 FROM project_lines WHERE project_id = ${projectId}))
    `;
  }

  /** The `order_id IS NULL` part makes sure a sent line never changes. */
  async setLineQuantity(lineId: string, quantity: number, db: SQL): Promise<void> {
    await db`
      UPDATE project_lines SET quantity = ${quantity} WHERE id = ${lineId} AND order_id IS NULL
    `;
  }

  async removeLine(lineId: string, db: SQL): Promise<void> {
    await db`DELETE FROM project_lines WHERE id = ${lineId} AND order_id IS NULL`;
  }

  async setLineOrder(lineId: string, orderId: string, db: SQL): Promise<void> {
    await db`
      UPDATE project_lines SET order_id = ${orderId} WHERE id = ${lineId} AND order_id IS NULL
    `;
  }

  private where(filter: ProjectFilter): SQL.Query<unknown> {
    const db = this.sql;
    const company = filter.companyId ? db`AND projects.company_id = ${filter.companyId}` : db``;
    const status = filter.statuses
      ? db`AND ${this.statusSql(db)} IN ${db([...filter.statuses])}`
      : db``;
    const notOver = filter.endsOnOrAfter
      ? db`AND projects.ends_on >= ${filter.endsOnOrAfter}`
      : db``;
    const waiting = filter.hasWaitingOrders
      ? db`AND EXISTS (SELECT 1 FROM orders WHERE orders.project_id = projects.id
          AND orders.status = ${OrderStatus.Pending})`
      : db``;
    const search = searchSql(db, filter.q, [
      db`projects.name`,
      db`projects.venue`,
      db`projects.city`,
      db`companies.name`,
    ]);
    return db`WHERE 1 = 1 ${company} ${status} ${notOver} ${waiting} ${search}`;
  }

  /**
   * The one place that works out the status of a project. The values are `ProjectStatus`.
   * - cancelled or done: the customer closed it.
   * - draft: no open order. An open order is pending, accepted or completed.
   * - waiting: an order waits for an answer.
   * - confirmed: every open order is accepted.
   */
  private statusSql(db: SQL): SQL.Query<unknown> {
    const open = db`SELECT 1 FROM orders WHERE orders.project_id = projects.id`;
    return db`(CASE
      WHEN projects.cancelled_at IS NOT NULL THEN 'cancelled'
      WHEN projects.done_at IS NOT NULL THEN 'done'
      WHEN NOT EXISTS (${open} AND orders.status IN
        (${OrderStatus.Pending}, ${OrderStatus.Accepted}, ${OrderStatus.Completed})) THEN 'draft'
      WHEN EXISTS (${open} AND orders.status = ${OrderStatus.Pending}) THEN 'waiting'
      ELSE 'confirmed'
    END)`;
  }

  private orderBy(db: SQL, filter: ProjectFilter): SQL.Query<unknown> {
    const sort = filter.sort ?? ProjectSort.Event;
    if (sort === ProjectSort.Next) {
      // The events to come: the next one first. Then the events that are over: the last one first.
      const today = filter.today ?? "";
      return db`ORDER BY CASE WHEN projects.ends_on < ${today} THEN 1 ELSE 0 END,
        CASE WHEN projects.ends_on < ${today} THEN NULL ELSE projects.starts_on END,
        projects.starts_on DESC, projects.created_at DESC, projects.id`;
    }
    if (sort === ProjectSort.Soonest) {
      return db`ORDER BY projects.starts_on, projects.created_at, projects.id`;
    }
    if (sort === ProjectSort.Newest) {
      return db`ORDER BY projects.created_at DESC, projects.id`;
    }
    return db`ORDER BY projects.starts_on DESC, projects.created_at DESC, projects.id`;
  }

  private select(
    db: SQL,
    where: SQL.Query<unknown>,
    filter: ProjectFilter = {},
    page?: PageQuery,
  ): Promise<ProjectRow[]> {
    const active = db`orders.status IN (${OrderStatus.Pending}, ${OrderStatus.Accepted}, ${OrderStatus.Completed})`;
    const limit = page ? db`LIMIT ${page.limit} OFFSET ${page.offset}` : db``;
    return db`
      SELECT projects.*, companies.name AS company_name, ${this.statusSql(db)} AS status,
        (SELECT COUNT(*) FROM orders WHERE orders.project_id = projects.id) AS order_count,
        (SELECT COUNT(*) FROM orders WHERE orders.project_id = projects.id
          AND orders.status = ${OrderStatus.Pending}) AS pending_order_count,
        (SELECT COUNT(*) FROM orders WHERE orders.project_id = projects.id
          AND ${active}) AS active_order_count,
        (SELECT COUNT(*) FROM orders WHERE orders.project_id = projects.id
          AND orders.status = ${OrderStatus.Accepted}) AS accepted_order_count,
        (SELECT COALESCE(SUM(orders.total_cents), 0) FROM orders
          WHERE orders.project_id = projects.id AND ${active}) AS total_cents,
        (SELECT COUNT(*) FROM project_lines
          WHERE project_lines.project_id = projects.id) AS line_count
      FROM projects JOIN companies ON companies.id = projects.company_id
      ${where}
      ${this.orderBy(db, filter)}
      ${limit}
    `;
  }

  private selectLines(db: SQL, where: SQL.Query<unknown>): Promise<ProjectLineRow[]> {
    return db`
      SELECT project_lines.*, items.name AS item_name, items.category, items.sku, items.unit,
        items.price_cents, items.stock, items.hidden_at AS item_hidden_at,
        items.company_id AS owner_company_id, companies.name AS owner_company_name,
        companies.type AS owner_company_type, companies.disabled_at AS owner_disabled_at,
        companies.approved_at AS owner_approved_at,
        projects.company_id AS project_company_id, orders.status AS order_status,
        order_lines.unit_price_cents AS sent_price_cents,
        (SELECT file FROM item_photos WHERE item_photos.item_id = items.id
          ORDER BY position, created_at, id LIMIT 1) AS photo_file
      FROM project_lines
      JOIN projects ON projects.id = project_lines.project_id
      JOIN items ON items.id = project_lines.item_id
      JOIN companies ON companies.id = items.company_id
      LEFT JOIN orders ON orders.id = project_lines.order_id
      LEFT JOIN order_lines ON order_lines.order_id = project_lines.order_id
        AND order_lines.item_id = project_lines.item_id
      ${where}
      ORDER BY project_lines.position, project_lines.id
    `;
  }
}
