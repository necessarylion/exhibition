import type { Context } from "hono";
import { singleton } from "tsyringe";
import { UNREAD_COUNT_HEADER } from "../constants/notification.constants";
import { TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type { NotificationParam } from "../schemas/notification.schema";
import type { PageQuery } from "../schemas/page.schema";
import { NotificationService } from "../services/notification.service";

type ListContext = Context<AppEnv, string, { in: { query: PageQuery }; out: { query: PageQuery } }>;
type OneContext = Context<
  AppEnv,
  string,
  { in: { param: NotificationParam }; out: { param: NotificationParam } }
>;

@singleton()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  async list(c: ListContext) {
    const user = c.get("user");
    const page = await this.notificationService.list(user, c.req.valid("query"));
    const result = [];
    for (const notification of page.rows) {
      result.push(notification.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    c.header(UNREAD_COUNT_HEADER, String(await this.notificationService.countUnread(user)));
    return c.json(result, 200);
  }

  async readAll(c: Context<AppEnv>) {
    await this.notificationService.markAllRead(c.get("user"));
    return c.body(null, 204);
  }

  async read(c: OneContext) {
    const notification = await this.notificationService.markRead(
      c.get("user"),
      c.req.valid("param").id,
    );
    return c.json(notification.toPublic(), 200);
  }
}
