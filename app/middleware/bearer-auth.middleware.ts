import type { Context, Next } from "hono";
import { singleton } from "tsyringe";
import { BEARER_SCHEME, ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";
import type { User } from "../models/user.model";
import { AuthService } from "../services/auth.service";

/** Values the bearer middleware puts on the request context. */
export type AppEnv = { Variables: { user: User; token: string } };

@singleton()
export class BearerAuthMiddleware {
  constructor(private readonly authService: AuthService) {}

  async handle(c: Context<AppEnv>, next: Next): Promise<void> {
    const [scheme, token] = (c.req.header("Authorization") ?? "").split(" ");
    if (scheme !== BEARER_SCHEME || !token) {
      throw new AppError(401, ErrorCode.Unauthorized, "Send an `Authorization: Bearer` header.");
    }
    c.set("user", await this.authService.authenticate(token));
    c.set("token", token);
    await next();
  }
}
