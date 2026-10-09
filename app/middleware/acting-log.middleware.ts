import type { Context, Next } from "hono";
import { singleton } from "tsyringe";
import { API_PREFIX } from "../constants/api.constants";
import { AdminActionRepository } from "../repositories/admin-action.repository";
import { Clock } from "../services/clock.service";
import type { AppEnv } from "./bearer-auth.middleware";

/**
 * An admin who acts as a customer changes things in the name of the customer. Every such
 * change gets a row in `admin_actions`, so it is clear later that the admin did it.
 * It runs for every API request. Only a request with an acting token that changed
 * something is written: not a GET, and not a request that failed.
 */
@singleton()
export class ActingLog {
  constructor(
    private readonly actions: AdminActionRepository,
    private readonly clock: Clock,
  ) {}

  async handle(c: Context<AppEnv>, next: Next): Promise<void> {
    await next();
    // The bearer middleware of the route sets the user. A request without a token has none.
    const user = c.get("user");
    if (!user?.actingAdmin || c.req.method === "GET" || c.res.status >= 400) {
      return;
    }
    await this.actions.create({
      adminUserId: user.actingAdmin.id,
      adminName: user.actingAdmin.name,
      companyId: user.companyId,
      userId: user.id,
      action: `${c.req.method} ${c.req.path.slice(API_PREFIX.length)}`,
      createdAt: this.clock.timestamp(),
    });
  }
}
