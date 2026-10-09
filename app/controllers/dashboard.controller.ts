import type { Context } from "hono";
import { singleton } from "tsyringe";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import { DashboardService } from "../services/dashboard.service";

@singleton()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  async get(c: Context<AppEnv>) {
    return c.json(await this.dashboardService.get(c.get("user")), 200);
  }
}
