import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { serveStatic } from "hono/bun";
import { singleton } from "tsyringe";
import { AppConfig } from "./config/app.config";
import { BEARER_SCHEME, OPENAPI_PATH } from "./constants/api.constants";
import { CLIENT_DIR } from "./constants/paths.constants";
import type { AppEnv } from "./middleware/bearer-auth.middleware";
import { ErrorHandler } from "./middleware/error-handler.middleware";
import { AuthRoutes } from "./routes/auth.routes";
import { PageRoutes } from "./routes/page.routes";
import { UserRoutes } from "./routes/user.routes";

@singleton()
export class Application {
  constructor(
    private readonly config: AppConfig,
    private readonly errorHandler: ErrorHandler,
    private readonly authRoutes: AuthRoutes,
    private readonly userRoutes: UserRoutes,
    private readonly pageRoutes: PageRoutes,
  ) {}

  build(): OpenAPIHono<AppEnv> {
    const app = new OpenAPIHono<AppEnv>({
      defaultHook: this.errorHandler.validation.bind(this.errorHandler),
    });
    app.onError(this.errorHandler.handle.bind(this.errorHandler));
    app.notFound(this.errorHandler.notFound.bind(this.errorHandler));

    this.authRoutes.register(app);
    this.userRoutes.register(app);
    this.pageRoutes.register(app);

    app.openAPIRegistry.registerComponent("securitySchemes", BEARER_SCHEME, {
      type: "http",
      scheme: "bearer",
    });
    app.doc(OPENAPI_PATH, {
      openapi: "3.0.0",
      info: { title: `${this.config.appName} API`, version: "1.0.0" },
    });
    app.get("/docs", swaggerUI({ url: OPENAPI_PATH }));

    // The built Vue files. In development the Vite dev server serves them.
    app.use("/assets/*", serveStatic({ root: CLIENT_DIR }));

    return app;
  }
}
