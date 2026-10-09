import type { Context, Next } from "hono";
import { singleton } from "tsyringe";
import { InertiaMiddleware } from "../middleware/inertia.middleware";

/** These URLs are not pages. Other routes answer them: the API, the files and the docs. */
const NOT_PAGES = ["/api/", "/uploads/", "/assets/", "/docs", "/health"];

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

  /** It only explains who can set a new password. The app sends no email. */
  forgotPassword(c: Context) {
    return this.inertia.render(c, "ForgotPassword");
  }

  /** The messages of the app for me. Every role has this page. */
  notifications(c: Context) {
    return this.inertia.render(c, "Notifications");
  }

  /** What admins did while they acted as a customer. Only an admin gets data here. */
  adminActivity(c: Context) {
    return this.inertia.render(c, "AdminActivity");
  }

  /** The organization groups. Only an admin gets data on these pages. */
  adminGroups(c: Context) {
    return this.inertia.render(c, "AdminGroups");
  }

  adminGroupForm(c: Context) {
    return this.inertia.render(c, "AdminGroupForm");
  }

  adminGroupDetail(c: Context) {
    return this.inertia.render(c, "AdminGroupDetail");
  }

  /** Picks a customer company that is in no group yet. */
  adminGroupAdd(c: Context) {
    return this.inertia.render(c, "AdminGroupAdd");
  }

  dashboard(c: Context) {
    return this.inertia.render(c, "Dashboard");
  }

  /** The users of my company, or of the company an admin picked. */
  team(c: Context) {
    return this.inertia.render(c, "Team");
  }

  teamForm(c: Context) {
    return this.inertia.render(c, "TeamForm");
  }

  /** The owner, or an admin, sets a new password for a user. */
  resetPassword(c: Context) {
    return this.inertia.render(c, "ResetPassword");
  }

  /** My own name and password. */
  profile(c: Context) {
    return this.inertia.render(c, "Profile");
  }

  /** The profile of my company. Its owner can change it. */
  company(c: Context) {
    return this.inertia.render(c, "Company");
  }

  myItems(c: Context) {
    return this.inertia.render(c, "MyItems");
  }

  /** The same page creates and edits an item. */
  itemForm(c: Context) {
    return this.inertia.render(c, "ItemForm");
  }

  /** One page for both lists. It reads the company type from the URL. */
  adminCompanies(c: Context) {
    return this.inertia.render(c, "AdminCompanies");
  }

  /** The same page creates and edits a company. */
  adminCompanyForm(c: Context) {
    return this.inertia.render(c, "AdminCompanyForm");
  }

  /** The items a customer can add to a project. */
  catalog(c: Context) {
    return this.inertia.render(c, "Catalog");
  }

  catalogItem(c: Context) {
    return this.inertia.render(c, "CatalogItem");
  }

  /** One page for the projects of a customer and for the list of all projects of an admin. */
  projects(c: Context) {
    return this.inertia.render(c, "Projects");
  }

  /** The same page creates and edits a project. */
  projectForm(c: Context) {
    return this.inertia.render(c, "ProjectForm");
  }

  /** A customer works on the project here. An admin opens the same page read only. */
  projectDetail(c: Context) {
    return this.inertia.render(c, "ProjectDetail");
  }

  projectSend(c: Context) {
    return this.inertia.render(c, "ProjectSend");
  }

  /**
   * The orders of my company: for my items (supplier, admin) or of my projects (customer).
   * There is no list of every order. An admin sees the orders of others inside their project.
   */
  orders(c: Context) {
    return this.inertia.render(c, "Orders");
  }

  orderDetail(c: Context) {
    return this.inertia.render(c, "OrderDetail");
  }

  /**
   * The reason page: the supplier rejects a pending order or cancels an accepted one, and
   * an admin cancels an order from its project page.
   */
  orderReject(c: Context) {
    return this.inertia.render(c, "OrderReject");
  }

  /** An unknown page URL gets the "not found" page. Other URLs go on to the next route. */
  async notFound(c: Context, next: Next): Promise<Response | undefined> {
    for (const prefix of NOT_PAGES) {
      if (c.req.path.startsWith(prefix)) {
        await next();
        return;
      }
    }
    c.status(404);
    return this.inertia.render(c, "NotFound");
  }
}
