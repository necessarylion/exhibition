import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { UserController } from "../controllers/user.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { NotWhileActing } from "../middleware/not-while-acting.middleware";
import { RateLimitMiddleware } from "../middleware/rate-limit.middleware";
import {
  ChangePasswordSchema,
  CreateUserSchema,
  ResetPasswordSchema,
  UpdateMeSchema,
} from "../schemas/auth.schema";
import { errorResponse } from "../schemas/error.schema";
import { UserListQuerySchema, UserParamSchema, UserSchema } from "../schemas/user.schema";

@singleton()
export class UserRoutes {
  constructor(
    private readonly controller: UserController,
    private readonly bearerAuth: BearerAuthMiddleware,
    private readonly rateLimit: RateLimitMiddleware,
    private readonly notWhileActing: NotWhileActing,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const middleware = [this.bearerAuth.handle.bind(this.bearerAuth)];
    // An admin who acts as a customer must not change who can log in to that account.
    const asMyself = [...middleware, this.notWhileActing.handle.bind(this.notWhileActing)];
    const acting = errorResponse("An admin who acts as a customer cannot do this.");
    const security = [{ [BEARER_SCHEME]: [] }];
    const unauthorized = errorResponse("The token is missing, wrong or expired.");
    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/users/me`,
        tags: ["Users"],
        summary: "Get the logged-in user",
        security,
        middleware,
        responses: { 200: this.userResponse("The logged-in user."), 401: unauthorized },
      }),
      this.controller.me.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/users/me`,
        tags: ["Users"],
        summary: "Change my name",
        security,
        middleware: asMyself,
        request: {
          body: { required: true, content: { "application/json": { schema: UpdateMeSchema } } },
        },
        responses: {
          200: this.userResponse("The logged-in user with the new name."),
          401: unauthorized,
          403: acting,
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.updateMe.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/users/me/password`,
        tags: ["Users"],
        summary: "Change my password. My other devices are logged out.",
        security,
        middleware: [...asMyself, this.rateLimit.changePassword.bind(this.rateLimit)],
        request: {
          body: {
            required: true,
            content: { "application/json": { schema: ChangePasswordSchema } },
          },
        },
        responses: {
          204: { description: "Changed. The token of this request still works." },
          401: unauthorized,
          403: acting,
          422: errorResponse("The current password is wrong, or the input is not valid."),
          429: errorResponse("Too many wrong tries. `Retry-After` says how many seconds to wait."),
        },
      }),
      this.controller.changePassword.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/users`,
        tags: ["Users"],
        summary:
          "List the users of my company, the oldest first. An admin can name another company. `q` searches the name and the email.",
        security,
        middleware,
        request: { query: UserListQuerySchema },
        responses: {
          200: {
            description: "The users, oldest first. `X-Total-Count` has the number of all of them.",
            content: { "application/json": { schema: z.array(UserSchema) } },
          },
          401: unauthorized,
          404: errorResponse("The company does not exist or is not mine."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/users`,
        tags: ["Users"],
        summary: "Add a user to my company (owner only). An admin can name another company.",
        security,
        middleware: [...asMyself, this.rateLimit.addUser.bind(this.rateLimit)],
        request: {
          body: { required: true, content: { "application/json": { schema: CreateUserSchema } } },
        },
        responses: {
          201: this.userResponse("The new user."),
          401: unauthorized,
          403: errorResponse("Only the owner or an admin can add users."),
          404: errorResponse("The company does not exist or is not mine."),
          409: errorResponse("The email is already registered."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.create.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "delete",
        path: `${API_PREFIX}/users/{id}`,
        tags: ["Users"],
        summary: "Remove a user of my company (owner only), or of any company as an admin.",
        security,
        middleware: asMyself,
        request: { params: UserParamSchema },
        responses: {
          204: { description: "Removed. The user is logged out everywhere." },
          401: unauthorized,
          404: errorResponse("The user does not exist or is not in my company."),
          403: errorResponse("Only the owner or an admin can remove users."),
          409: errorResponse("The owner cannot be removed."),
        },
      }),
      this.controller.remove.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/users/{id}/password`,
        tags: ["Users"],
        summary:
          "Set a new password for a user of my company (owner only), or of any company as an admin.",
        security,
        middleware: asMyself,
        request: {
          params: UserParamSchema,
          body: {
            required: true,
            content: { "application/json": { schema: ResetPasswordSchema } },
          },
        },
        responses: {
          204: { description: "Changed. The user is logged out everywhere." },
          401: unauthorized,
          403: errorResponse("Only the owner or an admin can do this. Not for my own password."),
          404: errorResponse("The user does not exist or is not in my company."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.resetPassword.bind(this.controller),
    );
  }

  private userResponse(description: string) {
    return { description, content: { "application/json": { schema: UserSchema } } };
  }
}
