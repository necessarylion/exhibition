import type { Context } from "hono";
import { singleton } from "tsyringe";
import { InertiaMiddleware } from "../middleware/inertia.middleware";

@singleton()
export class PageController {
  constructor(private readonly inertia: InertiaMiddleware) {}

  home(c: Context) {
    return c.redirect("/dashboard");
  }

  login(c: Context) {
    return this.inertia.render(c, "Login");
  }

  register(c: Context) {
    return this.inertia.render(c, "Register");
  }

  dashboard(c: Context) {
    return this.inertia.render(c, "Dashboard");
  }
}
