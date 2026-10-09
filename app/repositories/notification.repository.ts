import { SQL } from "bun";
import { singleton } from "tsyringe";
import { Role } from "../constants/role.constants";
import { Notification, type NotificationRow } from "../models/notification.model";
import type { Page, PageQuery } from "../schemas/page.schema";

@singleton()
export class NotificationRepository {
  constructor(private readonly sql: SQL) {}

  /** The notifications of one user, the newest first. */
  async listByUser(userId: string, page: PageQuery): Promise<Page<Notification>> {
    const rows: NotificationRow[] = await this.sql`
      SELECT * FROM notifications WHERE user_id = ${userId}
      ORDER BY created_at DESC, id
      LIMIT ${page.limit} OFFSET ${page.offset}
    `;
    const [count] = await this.sql`
      SELECT COUNT(*) AS total FROM notifications WHERE user_id = ${userId}
    `;
    const notifications: Notification[] = [];
    for (const row of rows) {
      notifications.push(Notification.fromRow(row));
    }
    // PostgreSQL returns a COUNT as a string.
    return { rows: notifications, total: Number(count.total) };
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*) AS total FROM notifications WHERE user_id = ${userId} AND read_at IS NULL
    `;
    return Number(row.total);
  }

  /** `userId` is part of the query, so a user never reads the notification of another user. */
  async findForUser(id: string, userId: string): Promise<Notification | null> {
    const rows: NotificationRow[] = await this.sql`
      SELECT * FROM notifications WHERE id = ${id} AND user_id = ${userId}
    `;
    return rows[0] ? Notification.fromRow(rows[0]) : null;
  }

  /** A notification that is read already keeps its first date. */
  async markRead(id: string, userId: string, at: string): Promise<void> {
    await this.sql`
      UPDATE notifications SET read_at = COALESCE(read_at, ${at})
      WHERE id = ${id} AND user_id = ${userId}
    `;
  }

  async markAllRead(userId: string, at: string): Promise<void> {
    await this.sql`
      UPDATE notifications SET read_at = ${at} WHERE user_id = ${userId} AND read_at IS NULL
    `;
  }

  /** Pass `db` to write inside the transaction of the event. */
  async create(notification: Notification, db: SQL = this.sql): Promise<void> {
    await db`
      INSERT INTO notifications (id, user_id, text, link, read_at, created_at)
      VALUES (${notification.id}, ${notification.userId}, ${notification.text},
        ${notification.link}, ${notification.readAt}, ${notification.createdAt})
    `;
  }

  /** The ids of the users of one company. */
  async userIdsOfCompany(companyId: string, db: SQL = this.sql): Promise<string[]> {
    const rows: { id: string }[] = await db`SELECT id FROM users WHERE company_id = ${companyId}`;
    return this.ids(rows);
  }

  /** The ids of every platform admin. */
  async adminUserIds(db: SQL = this.sql): Promise<string[]> {
    const rows: { id: string }[] = await db`
      SELECT users.id FROM users JOIN companies ON companies.id = users.company_id
      WHERE companies.type = ${Role.Admin}
    `;
    return this.ids(rows);
  }

  /** `before` is an ISO string. ISO strings in UTC compare like dates. */
  async deleteOlderThan(before: string): Promise<void> {
    await this.sql`DELETE FROM notifications WHERE created_at < ${before}`;
  }

  private ids(rows: { id: string }[]): string[] {
    const ids: string[] = [];
    for (const row of rows) {
      ids.push(row.id);
    }
    return ids;
  }
}
