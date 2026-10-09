import type { Context, Next } from "hono";
import { ErrorCode } from "../constants/api.constants";
import type { Role } from "../constants/role.constants";
import { AppError } from "../errors/app.error";
import type { AppEnv } from "./bearer-auth.middleware";

/** Lets only the given roles pass. Put it after the bearer middleware. */
export class RoleGuard {
  constructor(private readonly roles: readonly Role[]) {}

  async handle(c: Context<AppEnv>, next: Next): Promise<void> {
    if (!this.roles.includes(c.get("user").role)) {
      throw new AppError(403, ErrorCode.Forbidden, "Your role cannot do this.");
    }
    await next();
  }
}
