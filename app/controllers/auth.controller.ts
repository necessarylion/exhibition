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
    return c.json(this.toResponse(result), 201);
  }

  async login(c: JsonContext<LoginInput>) {
    const result = await this.authService.login(c.req.valid("json"));
    return c.json(this.toResponse(result), 200);
  }

  async logout(c: Context<AppEnv>) {
    await this.authService.logout(c.get("token"));
    return c.body(null, 204);
  }

  private toResponse(result: AuthResult) {
    return {
      token: result.token,
      tokenType: BEARER_SCHEME,
      expiresAt: result.expiresAt,
      user: result.user.toPublic(),
    };
  }
}
