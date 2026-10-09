import { SQL } from "bun";
import { singleton } from "tsyringe";
import type { Page, PageQuery } from "../schemas/page.schema";

/** What an admin did in the name of a company. */
export interface AdminAction {
  adminUserId: string;
  adminName: string;
  companyId: string;
  /** The user the admin acted as. */
  userId: string;
  action: string;
  createdAt: string;
}

/** One row of the log, as the "Admin activity" page shows it. */
export interface AdminActionEntry {
  id: string;
  adminName: string;
  companyName: string;
  action: string;
  createdAt: string;
}

/**
 * The log of what admins did in the name of a company. `action` is `impersonate` for the
 * start, and the method and path of the request for every change after it.
 * Rows are only added. The daily cleaner deletes the rows that are older than a year.
 */
@singleton()
export class AdminActionRepository {
  constructor(private readonly sql: SQL) {}

  /** Pass `db` to write inside a transaction. */
  async create(action: AdminAction, db: SQL = this.sql): Promise<void> {
    await db`
      INSERT INTO admin_actions (id, admin_user_id, admin_name, company_id, user_id, action, created_at)
      VALUES (${crypto.randomUUID()}, ${action.adminUserId}, ${action.adminName},
        ${action.companyId}, ${action.userId}, ${action.action}, ${action.createdAt})
    `;
  }

  /** One page of the log, the newest first. */
  async list(page: PageQuery): Promise<Page<AdminActionEntry>> {
    const rows = await this.sql`
      SELECT admin_actions.id, admin_actions.admin_name, companies.name AS company_name,
        admin_actions.action, admin_actions.created_at
      FROM admin_actions JOIN companies ON companies.id = admin_actions.company_id
      ORDER BY admin_actions.created_at DESC, admin_actions.id
      LIMIT ${page.limit} OFFSET ${page.offset}
    `;
    const [count] = await this.sql`SELECT COUNT(*) AS total FROM admin_actions`;
    const entries: AdminActionEntry[] = [];
    for (const row of rows) {
      entries.push({
        id: row.id,
        adminName: row.admin_name,
        companyName: row.company_name,
        action: row.action,
        createdAt: row.created_at,
      });
    }
    // PostgreSQL returns a COUNT as a string.
    return { rows: entries, total: Number(count.total) };
  }

  /** `before` is an ISO string. ISO strings in UTC compare like dates. */
  async deleteOlderThan(before: string): Promise<void> {
    await this.sql`DELETE FROM admin_actions WHERE created_at < ${before}`;
  }
}
