import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { AuthController } from "../controllers/auth.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { AuthSchema, LoginSchema, RegisterSchema } from "../schemas/auth.schema";
import { errorResponse } from "../schemas/error.schema";

@singleton()
export class AuthRoutes {
  constructor(
    private readonly controller: AuthController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const authResponse = {
      description: "The user and a new Bearer token.",
      content: { "application/json": { schema: AuthSchema } },
    };

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/auth/register`,
        tags: ["Auth"],
        summary: "Create an account",
        request: {
          body: { required: true, content: { "application/json": { schema: RegisterSchema } } },
        },
        responses: {
          201: authResponse,
          409: errorResponse("The email is already registered."),
          422: errorResponse("The input is not valid."),
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
        request: {
          body: { required: true, content: { "application/json": { schema: LoginSchema } } },
        },
        responses: {
          200: authResponse,
          401: errorResponse("Email or password is wrong."),
          422: errorResponse("The input is not valid."),
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
  }
}
