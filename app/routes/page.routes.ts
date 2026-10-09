import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { singleton } from "tsyringe";
import { PageController } from "../controllers/page.controller";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import { InertiaMiddleware } from "../middleware/inertia.middleware";

type PageHandler = (c: Context) => Promise<Response>;

@singleton()
export class PageRoutes {
  constructor(
    private readonly controller: PageController,
    private readonly inertia: InertiaMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const inertia = this.inertia.handle.bind(this.inertia);
    const pages = this.controller;

    // The first URL that matches wins. So a fixed word like `/new` comes before `/:id`.
    const routes: [string, PageHandler][] = [
      ["/login", pages.login],
      ["/register", pages.register],
      ["/forgot-password", pages.forgotPassword],
      ["/notifications", pages.notifications],
      ["/dashboard", pages.dashboard],
      ["/team", pages.team],
      ["/team/new", pages.teamForm],
      ["/team/:id/password", pages.resetPassword],
      ["/profile", pages.profile],
      ["/company", pages.company],
      ["/items", pages.myItems],
      ["/items/new", pages.itemForm],
      ["/items/:id/edit", pages.itemForm],
      ["/catalog", pages.catalog],
      ["/catalog/:id", pages.catalogItem],
      ["/projects", pages.projects],
      ["/projects/new", pages.projectForm],
      ["/projects/:id/edit", pages.projectForm],
      ["/projects/:id/send", pages.projectSend],
      ["/projects/:id", pages.projectDetail],
      ["/orders", pages.orders],
      ["/orders/:id/reject", pages.orderReject],
      ["/orders/:id/cancel", pages.orderReject],
      ["/orders/:id", pages.orderDetail],
      ["/admin/projects", pages.projects],
      ["/admin/projects/:id/orders/:orderId/cancel", pages.orderReject],
      ["/admin/projects/:id", pages.projectDetail],
      ["/admin/activity", pages.adminActivity],
      ["/admin/groups", pages.adminGroups],
      ["/admin/groups/new", pages.adminGroupForm],
      ["/admin/groups/:id/add", pages.adminGroupAdd],
      ["/admin/groups/:id", pages.adminGroupDetail],
    ];
    for (const type of ["customers", "suppliers"]) {
      routes.push(
        [`/admin/${type}`, pages.adminCompanies],
        [`/admin/${type}/new`, pages.adminCompanyForm],
        [`/admin/${type}/:id/edit`, pages.adminCompanyForm],
        [`/admin/${type}/:id/users`, pages.team],
        [`/admin/${type}/:id/users/new`, pages.teamForm],
        [`/admin/${type}/:id/users/:userId/password`, pages.resetPassword],
      );
    }

    app.get("/", pages.home.bind(pages));
    for (const [path, handler] of routes) {
      app.get(path, inertia, handler.bind(pages));
    }
    // Every other URL. It must stay the last page route.
    app.get("*", inertia, pages.notFound.bind(pages));
  }
}
