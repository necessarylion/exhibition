import type { Context } from "hono";
import { singleton } from "tsyringe";
import { HealthRepository } from "../repositories/health.repository";

@singleton()
export class HealthController {
  constructor(private readonly health: HealthRepository) {}

  /** For the load balancer and the Docker health check. No login needed. */
  async check(c: Context) {
    try {
      await this.health.ping();
    } catch (error) {
      console.error("Health check: the database does not answer.", error);
      return c.json({ status: "error" }, 503);
    }
    return c.json({ status: "ok" }, 200);
  }
}
