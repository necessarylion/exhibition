import type { Context } from "hono";
import { singleton } from "tsyringe";
import type { AppEnv } from "../middleware/bearer-auth.middleware";

@singleton()
export class UserController {
  // ponytail: no UserService yet. The bearer middleware already loaded the user.
  // Add a service when a user endpoint needs business logic.
  me(c: Context<AppEnv>) {
    return c.json(c.get("user").toPublic(), 200);
  }
}
