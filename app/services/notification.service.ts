import type { SQL } from "bun";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";
import { Notification } from "../models/notification.model";
import type { User } from "../models/user.model";
import { NotificationRepository } from "../repositories/notification.repository";
import type { Page, PageQuery } from "../schemas/page.schema";
import { Clock } from "./clock.service";

/**
 * Messages inside the app. No email is sent: the app makes no call to another service.
 * An event writes one row for every user of the company that should know. The service of
 * the event passes its `db`, so the event and its messages are saved together or not at all.
 */
@singleton()
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  /** Tells every user of the company. */
  async notifyCompany(companyId: string, text: string, link: string, db?: SQL): Promise<void> {
    await this.write(await this.notifications.userIdsOfCompany(companyId, db), text, link, db);
  }

  /** Tells every platform admin. */
  async notifyAdmins(text: string, link: string, db?: SQL): Promise<void> {
    await this.write(await this.notifications.adminUserIds(db), text, link, db);
  }

  list(user: User, page: PageQuery): Promise<Page<Notification>> {
    return this.notifications.listByUser(user.id, page);
  }

  countUnread(user: User): Promise<number> {
    return this.notifications.countUnread(user.id);
  }

  /** A notification of another user counts as not found. This does not reveal that it exists. */
  async markRead(user: User, id: string): Promise<Notification> {
    if (!(await this.notifications.findForUser(id, user.id))) {
      throw this.notFound();
    }
    await this.notifications.markRead(id, user.id, this.clock.timestamp());
    const saved = await this.notifications.findForUser(id, user.id);
    if (!saved) {
      throw this.notFound();
    }
    return saved;
  }

  async markAllRead(user: User): Promise<void> {
    await this.notifications.markAllRead(user.id, this.clock.timestamp());
  }

  private async write(userIds: string[], text: string, link: string, db?: SQL): Promise<void> {
    for (const userId of userIds) {
      await this.notifications.create(
        new Notification(crypto.randomUUID(), userId, text, link, this.clock.timestamp()),
        db,
      );
    }
  }

  private notFound(): AppError {
    return new AppError(404, ErrorCode.NotFound, "Notification not found.");
  }
}
