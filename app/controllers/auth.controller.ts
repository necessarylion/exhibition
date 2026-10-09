import type { Context } from "hono";
import { singleton } from "tsyringe";
import { BEARER_SCHEME } from "../constants/api.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type { LoginInput, RegisterInput } from "../schemas/auth.schema";
import { type AuthResult, AuthService } from "../services/auth.service";

type JsonContext<T> = Context<AppEnv, string, { in: { json: T }; out: { json: T } }>;

@singleton()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async register(c: JsonContext<RegisterInput>) {
    const result = await this.authService.register(c.req.valid("json"));
    return c.json(toAuthResponse(result), 201);
  }

  async login(c: JsonContext<LoginInput>) {
    const result = await this.authService.login(c.req.valid("json"));
    return c.json(toAuthResponse(result), 200);
  }

  async logout(c: Context<AppEnv>) {
    await this.authService.logout(c.get("user"), c.get("token"));
    return c.body(null, 204);
  }

  async stopImpersonating(c: Context<AppEnv>) {
    await this.authService.stopImpersonating(c.get("user"), c.get("token"));
    return c.body(null, 204);
  }

  async logoutAll(c: Context<AppEnv>) {
    await this.authService.logoutAll(c.get("user"));
    return c.body(null, 204);
  }
}

/** The body of every answer that gives a new token. */
export function toAuthResponse(result: AuthResult) {
  return {
    token: result.token,
    tokenType: BEARER_SCHEME,
    expiresAt: result.expiresAt,
    user: result.user.toPublic(),
  };
}
