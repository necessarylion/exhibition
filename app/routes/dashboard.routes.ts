import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { DashboardController } from "../controllers/dashboard.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { DashboardSchema } from "../schemas/dashboard.schema";
import { errorResponse } from "../schemas/error.schema";

@singleton()
export class DashboardRoutes {
  constructor(
    private readonly controller: DashboardController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/dashboard`,
        tags: ["Dashboard"],
        summary: "The numbers and short lists of the first page. The shape depends on my role.",
        security: [{ [BEARER_SCHEME]: [] }],
        middleware: [this.bearerAuth.handle.bind(this.bearerAuth)] as const,
        responses: {
          200: {
            description: "The dashboard of my role. `role` tells which shape it is.",
            content: { "application/json": { schema: DashboardSchema } },
          },
          401: errorResponse("The token is missing, wrong or expired."),
        },
      }),
      this.controller.get.bind(this.controller),
    );
  }
}
