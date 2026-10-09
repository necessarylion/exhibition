import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { UserController } from "../controllers/user.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { errorResponse } from "../schemas/error.schema";
import { UserSchema } from "../schemas/user.schema";

@singleton()
export class UserRoutes {
  constructor(
    private readonly controller: UserController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/users/me`,
        tags: ["Users"],
        summary: "Get the logged-in user",
        security: [{ [BEARER_SCHEME]: [] }],
        middleware: [this.bearerAuth.handle.bind(this.bearerAuth)] as const,
        responses: {
          200: {
            description: "The logged-in user.",
            content: { "application/json": { schema: UserSchema } },
          },
          401: errorResponse("The token is missing, wrong or expired."),
        },
      }),
      this.controller.me.bind(this.controller),
    );
  }
}
