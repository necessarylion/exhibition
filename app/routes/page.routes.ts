import type { OpenAPIHono } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { PageController } from "../controllers/page.controller";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import { InertiaMiddleware } from "../middleware/inertia.middleware";

@singleton()
export class PageRoutes {
  constructor(
    private readonly controller: PageController,
    private readonly inertia: InertiaMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const inertia = this.inertia.handle.bind(this.inertia);

    app.get("/", this.controller.home.bind(this.controller));
    app.get("/login", inertia, this.controller.login.bind(this.controller));
    app.get("/register", inertia, this.controller.register.bind(this.controller));
    app.get("/dashboard", inertia, this.controller.dashboard.bind(this.controller));
  }
}
