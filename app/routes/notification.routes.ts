import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { NotificationController } from "../controllers/notification.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { errorResponse } from "../schemas/error.schema";
import { NotificationParamSchema, NotificationSchema } from "../schemas/notification.schema";
import { PageQuerySchema } from "../schemas/page.schema";

/** My notifications. Every role has them. A user reaches only their own. */
@singleton()
export class NotificationRoutes {
  constructor(
    private readonly controller: NotificationController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const middleware = [this.bearerAuth.handle.bind(this.bearerAuth)];
    const security = [{ [BEARER_SCHEME]: [] }];
    const tags = ["Notifications"];
    const unauthorized = errorResponse("The token is missing, wrong or expired.");

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/notifications`,
        tags,
        summary: "List my notifications, the newest first",
        security,
        middleware,
        request: { query: PageQuerySchema },
        responses: {
          200: {
            description:
              "My notifications. `X-Total-Count` has the number of all of them. `X-Unread-Count` has the number of new ones.",
            content: { "application/json": { schema: z.array(NotificationSchema) } },
          },
          401: unauthorized,
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/notifications/read`,
        tags,
        summary: "Mark all my notifications as read",
        security,
        middleware,
        responses: { 204: { description: "All of them are read." }, 401: unauthorized },
      }),
      this.controller.readAll.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/notifications/{id}/read`,
        tags,
        summary: "Mark one of my notifications as read",
        security,
        middleware,
        request: { params: NotificationParamSchema },
        responses: {
          200: {
            description: "The notification.",
            content: { "application/json": { schema: NotificationSchema } },
          },
          401: unauthorized,
          404: errorResponse("It does not exist, or it is not mine."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.read.bind(this.controller),
    );
  }
}
