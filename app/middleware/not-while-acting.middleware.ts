import type { Context, Next } from "hono";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";
import type { AppEnv } from "./bearer-auth.middleware";

/**
 * Stops an admin who acts as a customer. The admin works in the account of the customer,
 * but must not change who can log in to it: no new name or password, no new or removed
 * user, no "log out everywhere". Put it after the bearer middleware.
 */
@singleton()
export class NotWhileActing {
  async handle(c: Context<AppEnv>, next: Next): Promise<void> {
    if (c.get("user").actingAdmin) {
      throw new AppError(
        403,
        ErrorCode.NotWhileActing,
        "You cannot do this while you act as a customer. Stop acting first.",
      );
    }
    await next();
  }
}
