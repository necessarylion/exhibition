import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SQL } from "bun";
import { Application } from "../../app/app";
import { AppConfig, type Env } from "../../app/config/app.config";
import { AuthController } from "../../app/controllers/auth.controller";
import { CompanyController } from "../../app/controllers/company.controller";
import { DashboardController } from "../../app/controllers/dashboard.controller";
import { HealthController } from "../../app/controllers/health.controller";
import { ItemController } from "../../app/controllers/item.controller";
import { NotificationController } from "../../app/controllers/notification.controller";
import { OrderController } from "../../app/controllers/order.controller";
import { OrganizationController } from "../../app/controllers/organization.controller";
import { PageController } from "../../app/controllers/page.controller";
import { ProjectController } from "../../app/controllers/project.controller";
import { UserController } from "../../app/controllers/user.controller";
import { ActingLog } from "../../app/middleware/acting-log.middleware";
import { BearerAuthMiddleware } from "../../app/middleware/bearer-auth.middleware";
import { ErrorHandler } from "../../app/middleware/error-handler.middleware";
import { InertiaMiddleware } from "../../app/middleware/inertia.middleware";
import { NotWhileActing } from "../../app/middleware/not-while-acting.middleware";
import { RateLimitMiddleware } from "../../app/middleware/rate-limit.middleware";
import { AccessTokenRepository } from "../../app/repositories/access-token.repository";
import { AdminActionRepository } from "../../app/repositories/admin-action.repository";
import { CompanyRepository } from "../../app/repositories/company.repository";
import { DashboardRepository } from "../../app/repositories/dashboard.repository";
import { HealthRepository } from "../../app/repositories/health.repository";
import { ItemRepository } from "../../app/repositories/item.repository";
import { NotificationRepository } from "../../app/repositories/notification.repository";
import { OrderRepository } from "../../app/repositories/order.repository";
import { OrganizationRepository } from "../../app/repositories/organization.repository";
import { ProjectRepository } from "../../app/repositories/project.repository";
import { TransactionRunner } from "../../app/repositories/transaction-runner";
import { UserRepository } from "../../app/repositories/user.repository";
import { AuthRoutes } from "../../app/routes/auth.routes";
import { CompanyRoutes } from "../../app/routes/company.routes";
import { DashboardRoutes } from "../../app/routes/dashboard.routes";
import { ItemRoutes } from "../../app/routes/item.routes";
import { NotificationRoutes } from "../../app/routes/notification.routes";
import { OrderRoutes } from "../../app/routes/order.routes";
import { OrganizationRoutes } from "../../app/routes/organization.routes";
import { PageRoutes } from "../../app/routes/page.routes";
import { ProjectRoutes } from "../../app/routes/project.routes";
import { UserRoutes } from "../../app/routes/user.routes";
import { AuthService } from "../../app/services/auth.service";
import { Clock } from "../../app/services/clock.service";
import { CompanyService } from "../../app/services/company.service";
import { DashboardService } from "../../app/services/dashboard.service";
import { ItemService } from "../../app/services/item.service";
import { NotificationService } from "../../app/services/notification.service";
import { OrderService } from "../../app/services/order.service";
import { OrganizationService } from "../../app/services/organization.service";
import { PhotoStorageService } from "../../app/services/photo-storage.service";
import { ProjectService } from "../../app/services/project.service";
import { RateLimiter } from "../../app/services/rate-limiter.service";
import { UserService } from "../../app/services/user.service";
import { Migrator } from "../../database/migrator";
import { openDatabase as open } from "../../database/open-database";

export const PASSWORD = "a-long-password";

/** The database of each test app. `Client.signUp` approves a supplier in it. */
const databases = new WeakMap<object, SQL>();

/**
 * A clock that a test can move. It starts at a fixed day, so the event dates in the tests
 * (from October 2026 on) are in the future on every day the tests run.
 */
export class TestClock extends Clock {
  time = Date.parse("2026-09-01T12:00:00.000Z");

  override now(): number {
    return this.time;
  }
}

/**
 * A new, empty database with every migration.
 * In-memory SQLite, or the PostgreSQL database of `TEST_DATABASE_URL` when it is set.
 * On PostgreSQL every call empties the database first, so use a database only for tests.
 */
export async function openDatabase(): Promise<SQL> {
  const url = Bun.env.TEST_DATABASE_URL;
  const sql = await open(url ?? ":memory:");
  if (url) {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  }
  await new Migrator(sql).run();
  return sql;
}

/**
 * The whole app, wired by hand (no container).
 * The login limit is off by default, because one test file logs in many times.
 */
export async function buildApp(env: Env = {}) {
  const sql = await openDatabase();
  const config = new AppConfig({
    NODE_ENV: "test",
    STORAGE_DIR: await mkdtemp(`${tmpdir()}/exhibition-`),
    RATE_LIMIT_MAX: "1000000",
    RATE_LIMIT_IP_MAX: "1000000",
    RATE_LIMIT_EMAIL_MAX: "1000000",
    ...env,
  });
  const clock = new TestClock();
  const transactions = new TransactionRunner(sql);
  const companies = new CompanyRepository(sql, transactions);
  const users = new UserRepository(sql);
  const tokens = new AccessTokenRepository(sql);
  const items = new ItemRepository(sql);
  const projects = new ProjectRepository(sql, transactions);
  const orders = new OrderRepository(sql);
  const notifications = new NotificationRepository(sql);
  const adminActions = new AdminActionRepository(sql);
  const notificationService = new NotificationService(notifications, clock);
  const organizationService = new OrganizationService(
    new OrganizationRepository(sql),
    companies,
    clock,
  );
  const authService = new AuthService(
    users,
    companies,
    tokens,
    config,
    clock,
    notificationService,
    adminActions,
  );
  const projectService = new ProjectService(
    projects,
    orders,
    items,
    clock,
    notificationService,
    companies,
  );
  const orderService = new OrderService(orders, projects, items, notificationService);
  const photos = new PhotoStorageService(config);
  const itemService = new ItemService(items, photos, projects, clock);
  const companyService = new CompanyService(
    companies,
    authService,
    organizationService,
    notificationService,
    clock,
    orderService,
    adminActions,
  );
  const userService = new UserService(users, companies, tokens, authService);
  const notWhileActing = new NotWhileActing();
  const bearerAuth = new BearerAuthMiddleware(authService);
  const inertia = new InertiaMiddleware(config);
  const limiter = new RateLimiter(clock);
  const rateLimit = new RateLimitMiddleware(limiter, config);
  const app = new Application(
    config,
    new ErrorHandler(),
    new HealthController(new HealthRepository(sql)),
    new AuthRoutes(new AuthController(authService), bearerAuth, rateLimit, notWhileActing),
    new UserRoutes(
      new UserController(userService, authService),
      bearerAuth,
      rateLimit,
      notWhileActing,
    ),
    new CompanyRoutes(
      new CompanyController(companyService, authService),
      bearerAuth,
      notWhileActing,
    ),
    new ItemRoutes(new ItemController(itemService), bearerAuth),
    new ProjectRoutes(new ProjectController(projectService), bearerAuth),
    new OrderRoutes(new OrderController(orderService), bearerAuth),
    new DashboardRoutes(
      new DashboardController(
        new DashboardService(new DashboardRepository(sql), projects, orders, clock),
      ),
      bearerAuth,
    ),
    new OrganizationRoutes(new OrganizationController(organizationService), bearerAuth),
    new NotificationRoutes(new NotificationController(notificationService), bearerAuth),
    new PageRoutes(new PageController(inertia), inertia),
    transactions,
    new ActingLog(adminActions, clock),
  ).build();
  databases.set(app, sql);
  return {
    app,
    sql,
    config,
    clock,
    limiter,
    authService,
    projectService,
    orderService,
    itemService,
    companyService,
    userService,
    organizationService,
    photos,
    users,
    companies,
    tokens,
    items,
    projects,
    orders,
    notifications,
    notificationService,
    adminActions,
    transactions,
  };
}

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

/** Short helpers for the requests of a test. */
export class Client {
  constructor(private readonly app: TestApp["app"]) {}

  post(path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return this.app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  send(method: string, path: string, token: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return this.app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async json(path: string, token: string) {
    return (await this.send("GET", path, token)).json();
  }

  /**
   * Sends the lines of a project that are not sent yet. It sends the total that the
   * project shows now, like the send page does.
   */
  async sendProject(projectId: string, token: string, body: object = {}) {
    const detail = await this.json(`/api/v1/projects/${projectId}`, token);
    let expectedTotalCents = 0;
    for (const line of detail.lines ?? []) {
      if (line.state === "not_sent") {
        expectedTotalCents += line.lineTotalCents;
      }
    }
    const path = `/api/v1/projects/${projectId}/send`;
    return this.send("POST", path, token, { expectedTotalCents, ...body });
  }

  async login(email: string, password = PASSWORD) {
    const response = await this.post("/api/v1/auth/login", { email, password });
    return { status: response.status, token: (await response.json()).token as string };
  }

  /**
   * Signs up a company. Returns the token and the user of its owner.
   * A supplier that signs up waits for an admin. Most tests need a supplier that can sell,
   * so this approves it in the database at once. Pass `approve: false` to keep it waiting.
   */
  async signUp(role: string, email: string, companyName: string, approve = true) {
    const body = { name: companyName, email, password: PASSWORD, role, companyName };
    const response = await this.post("/api/v1/auth/register", body);
    const auth = (await response.json()) as {
      token: string;
      user: { id: string; companyId: string; name: string };
    };
    const sql = databases.get(this.app);
    if (approve && sql && auth.user) {
      await sql`UPDATE companies SET approved_at = created_at WHERE id = ${auth.user.companyId}`;
    }
    return auth;
  }
}
