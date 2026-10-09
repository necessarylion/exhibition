import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { AuthController } from "../controllers/auth.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { NotWhileActing } from "../middleware/not-while-acting.middleware";
import { RateLimitMiddleware } from "../middleware/rate-limit.middleware";
import { AuthSchema, LoginSchema, RegisterSchema } from "../schemas/auth.schema";
import { errorResponse } from "../schemas/error.schema";

@singleton()
export class AuthRoutes {
  constructor(
    private readonly controller: AuthController,
    private readonly bearerAuth: BearerAuthMiddleware,
    private readonly rateLimit: RateLimitMiddleware,
    private readonly notWhileActing: NotWhileActing,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const authResponse = {
      description: "The user and a new Bearer token.",
      content: { "application/json": { schema: AuthSchema } },
    };
    const tooMany = errorResponse(
      "Too many attempts. The `Retry-After` header says how many seconds to wait.",
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/register`,
        tags: ["Auth"],
        summary: "Create an account",
        middleware: [this.rateLimit.register.bind(this.rateLimit)] as const,
        request: {
          body: { required: true, content: { "application/json": { schema: RegisterSchema } } },
        },
        responses: {
          201: authResponse,
          409: errorResponse("The email is already registered, or the company name is taken."),
          422: errorResponse("The input is not valid."),
          429: tooMany,
        },
      }),
      this.controller.register.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/login`,
        tags: ["Auth"],
        summary: "Log in and get a Bearer token",
        middleware: [this.rateLimit.login.bind(this.rateLimit)] as const,
        request: {
          body: { required: true, content: { "application/json": { schema: LoginSchema } } },
        },
        responses: {
          200: authResponse,
          401: errorResponse("Email or password is wrong."),
          422: errorResponse("The input is not valid."),
          429: tooMany,
        },
      }),
      this.controller.login.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/logout`,
        tags: ["Auth"],
        summary: "Log out. The token stops working.",
        security: [{ [BEARER_SCHEME]: [] }],
        middleware: [this.bearerAuth.handle.bind(this.bearerAuth)] as const,
        responses: {
          204: { description: "Logged out." },
          401: errorResponse("The token is missing, wrong or expired."),
        },
      }),
      this.controller.logout.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/logout-all`,
        tags: ["Auth"],
        summary: "Log out on every device. All my tokens stop working.",
        security: [{ [BEARER_SCHEME]: [] }],
        middleware: [
          this.bearerAuth.handle.bind(this.bearerAuth),
          this.notWhileActing.handle.bind(this.notWhileActing),
        ] as const,
        responses: {
          204: { description: "Logged out everywhere." },
          401: errorResponse("The token is missing, wrong or expired."),
          403: errorResponse("An admin who acts as a customer cannot do this."),
        },
      }),
      this.controller.logoutAll.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/stop-impersonating`,
        tags: ["Auth"],
        summary: "Stop acting as a customer. The token of this request stops working.",
        description:
          "Send the token that `POST /companies/{id}/impersonate` gave. The own token of the admin keeps working.",
        security: [{ [BEARER_SCHEME]: [] }],
        middleware: [this.bearerAuth.handle.bind(this.bearerAuth)] as const,
        responses: {
          204: { description: "Stopped." },
          401: errorResponse("The token is missing, wrong or expired."),
          409: errorResponse("This token is a normal login, not an acting session."),
        },
      }),
      this.controller.stopImpersonating.bind(this.controller),
    );
  }
}
