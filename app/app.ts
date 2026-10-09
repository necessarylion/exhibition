import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Context, MiddlewareHandler, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { singleton } from "tsyringe";
import { AppConfig } from "./config/app.config";
import {
  API_PREFIX,
  BEARER_SCHEME,
  DOCS_PATH,
  DOCS_SCRIPT_URL,
  ErrorCode,
  HEALTH_PATH,
  MAX_JSON_BODY_BYTES,
  OPENAPI_PATH,
} from "./constants/api.constants";
import { CLIENT_DIR } from "./constants/paths.constants";
import { MAX_PHOTO_REQUEST_BYTES, UPLOADS_URL } from "./constants/upload.constants";
import { HealthController } from "./controllers/health.controller";
import { AppError } from "./errors/app.error";
import { ActingLog } from "./middleware/acting-log.middleware";
import type { AppEnv } from "./middleware/bearer-auth.middleware";
import { ErrorHandler } from "./middleware/error-handler.middleware";
import { TransactionRunner } from "./repositories/transaction-runner";
import { AuthRoutes } from "./routes/auth.routes";
import { CompanyRoutes } from "./routes/company.routes";
import { DashboardRoutes } from "./routes/dashboard.routes";
import { ItemRoutes } from "./routes/item.routes";
import { NotificationRoutes } from "./routes/notification.routes";
import { OrderRoutes } from "./routes/order.routes";
import { OrganizationRoutes } from "./routes/organization.routes";
import { PageRoutes } from "./routes/page.routes";
import { ProjectRoutes } from "./routes/project.routes";
import { UserRoutes } from "./routes/user.routes";

// The API docs page (Scalar) loads its script, styles and fonts from these hosts.
const DOCS_CDN = "https://cdn.jsdelivr.net";
const DOCS_FONTS = "https://fonts.scalar.com";

@singleton()
export class Application {
  private readonly pageHeaders: MiddlewareHandler;
  private readonly docsHeaders: MiddlewareHandler;
  private readonly jsonBodyLimit = bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: this.tooLarge.bind(this),
  });
  private readonly photoBodyLimit = bodyLimit({
    maxSize: MAX_PHOTO_REQUEST_BYTES,
    onError: this.photoTooLarge.bind(this),
  });

  constructor(
    private readonly config: AppConfig,
    private readonly errorHandler: ErrorHandler,
    private readonly healthController: HealthController,
    private readonly authRoutes: AuthRoutes,
    private readonly userRoutes: UserRoutes,
    private readonly companyRoutes: CompanyRoutes,
    private readonly itemRoutes: ItemRoutes,
    private readonly projectRoutes: ProjectRoutes,
    private readonly orderRoutes: OrderRoutes,
    private readonly dashboardRoutes: DashboardRoutes,
    private readonly organizationRoutes: OrganizationRoutes,
    private readonly notificationRoutes: NotificationRoutes,
    private readonly pageRoutes: PageRoutes,
    private readonly transactions: TransactionRunner,
    private readonly actingLog: ActingLog,
  ) {
    this.pageHeaders = this.buildPageHeaders();
    this.docsHeaders = this.buildDocsHeaders();
  }

  build(): OpenAPIHono<AppEnv> {
    const app = new OpenAPIHono<AppEnv>({
      defaultHook: this.errorHandler.validation.bind(this.errorHandler),
    });
    app.onError(this.errorHandler.handle.bind(this.errorHandler));
    app.notFound(this.errorHandler.notFound.bind(this.errorHandler));

    if (this.config.logRequests) {
      app.use(this.logRequest.bind(this));
    }
    // Every response gets the security headers: pages, API, uploads and errors.
    app.use(this.secure.bind(this));

    // No API request may send a big body. It runs before the routes read anything.
    app.use(`${API_PREFIX}/*`, this.limitBody.bind(this));

    // On SQLite one API request runs at a time. See `TransactionRunner`.
    app.use(`${API_PREFIX}/*`, this.oneAtATime.bind(this));

    // Writes down what an admin changes while acting as a customer.
    app.use(`${API_PREFIX}/*`, this.actingLog.handle.bind(this.actingLog));

    app.get(HEALTH_PATH, this.healthController.check.bind(this.healthController));

    this.authRoutes.register(app);
    this.userRoutes.register(app);
    this.companyRoutes.register(app);
    this.itemRoutes.register(app);
    this.projectRoutes.register(app);
    this.orderRoutes.register(app);
    this.dashboardRoutes.register(app);
    this.organizationRoutes.register(app);
    this.notificationRoutes.register(app);
    this.pageRoutes.register(app);

    app.openAPIRegistry.registerComponent("securitySchemes", BEARER_SCHEME, {
      type: "http",
      scheme: "bearer",
    });
    // The description of the API and its docs page go together: both on, or both off.
    if (this.config.apiDocs) {
      app.doc(OPENAPI_PATH, {
        openapi: "3.0.0",
        info: { title: `${this.config.appName} API`, version: "1.0.0" },
      });
      app.get(DOCS_PATH, Scalar({ url: OPENAPI_PATH, cdn: DOCS_SCRIPT_URL }));
    }

    // The built Vue files. In development the Vite dev server serves them.
    app.use("/assets/*", serveStatic({ root: CLIENT_DIR }));

    // The uploaded photos. The `nosniff` security header makes the browser trust only
    // the file type we send.
    app.use(`${UPLOADS_URL}/*`, serveStatic({ root: this.config.storageDir }));

    return app;
  }

  /** One line per request. Only the method, the path, the status and the time. */
  private async logRequest(c: Context, next: Next): Promise<void> {
    const start = performance.now();
    await next();
    // The query string, the headers and the body are never printed. They can hold secrets.
    const ms = Math.round(performance.now() - start);
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  }

  /** The photo upload has its own, bigger limit. */
  private limitBody(c: Context, next: Next): ReturnType<MiddlewareHandler> {
    const limit = c.req.path.endsWith("/photos") ? this.photoBodyLimit : this.jsonBodyLimit;
    return limit(c, next);
  }

  /**
   * SQLite only. The body is read before the wait, so a client that sends its body slowly
   * holds nobody up. PostgreSQL runs the requests side by side.
   */
  private async oneAtATime(c: Context, next: Next): Promise<void> {
    if (!this.transactions.serial) {
      return next();
    }
    // Hono keeps the body, so the route reads it again from memory.
    await c.req.arrayBuffer();
    await this.transactions.aloneWithTimeout(next);
  }

  private photoTooLarge(): never {
    throw new AppError(413, ErrorCode.FileTooLarge, "The photo can be up to 5 MB.");
  }

  private tooLarge(): never {
    throw new AppError(413, ErrorCode.BodyTooLarge, "The request is too big.");
  }

  private secure(c: Context, next: Next): ReturnType<MiddlewareHandler> {
    return c.req.path === DOCS_PATH ? this.docsHeaders(c, next) : this.pageHeaders(c, next);
  }

  /**
   * The browser may load scripts, styles, fonts and data only from this app.
   * The Inertia page data is a JSON block, not a script that runs, so no inline script is needed.
   * Vue sets `style` attributes, so inline styles are allowed.
   */
  private buildPageHeaders(): MiddlewareHandler {
    const self = "'self'";
    // In development the Vite dev server serves the scripts and styles, and a web socket
    // reloads the page.
    const vite = this.config.isProduction ? [] : [this.config.viteDevServerUrl];
    const viteSocket = this.config.isProduction
      ? []
      : [this.config.viteDevServerUrl.replace(/^http/, "ws")];
    // The Vite dev client starts a small worker from a `blob:` URL (it pings the dev server).
    // Production has no worker, so it gets no such rule.
    const viteWorker = this.config.isProduction ? {} : { workerSrc: [self, "blob:"] };
    return secureHeaders({
      // Browsers use this header only on HTTPS. It is sent in production only.
      strictTransportSecurity: this.config.isProduction,
      contentSecurityPolicy: {
        defaultSrc: [self],
        scriptSrc: [self, ...vite],
        styleSrc: [self, "'unsafe-inline'", ...vite],
        imgSrc: [self, "data:", "blob:", ...vite],
        fontSrc: [self, "data:", ...vite],
        connectSrc: [self, ...vite, ...viteSocket],
        ...viteWorker,
        objectSrc: ["'none'"],
        baseUri: [self],
        formAction: [self],
        frameAncestors: ["'none'"],
      },
    });
  }

  /** The docs page needs a script from a CDN and an inline script. Only this page allows it. */
  private buildDocsHeaders(): MiddlewareHandler {
    const self = "'self'";
    return secureHeaders({
      strictTransportSecurity: this.config.isProduction,
      contentSecurityPolicy: {
        defaultSrc: [self],
        scriptSrc: [self, "'unsafe-inline'", DOCS_CDN],
        styleSrc: [self, "'unsafe-inline'", DOCS_CDN],
        imgSrc: [self, "data:", "blob:", "https:"],
        fontSrc: [self, "data:", DOCS_CDN, DOCS_FONTS],
        connectSrc: [self, DOCS_CDN],
        workerSrc: [self, "blob:"],
        objectSrc: ["'none'"],
        baseUri: [self],
        frameAncestors: ["'none'"],
      },
    });
  }
}
