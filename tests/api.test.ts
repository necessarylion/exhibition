import { beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { Application } from "../app/app";
import { AppConfig } from "../app/config/app.config";
import { AuthController } from "../app/controllers/auth.controller";
import { PageController } from "../app/controllers/page.controller";
import { UserController } from "../app/controllers/user.controller";
import { BearerAuthMiddleware } from "../app/middleware/bearer-auth.middleware";
import { ErrorHandler } from "../app/middleware/error-handler.middleware";
import { InertiaMiddleware } from "../app/middleware/inertia.middleware";
import { AccessTokenRepository } from "../app/repositories/access-token.repository";
import { UserRepository } from "../app/repositories/user.repository";
import { AuthRoutes } from "../app/routes/auth.routes";
import { PageRoutes } from "../app/routes/page.routes";
import { UserRoutes } from "../app/routes/user.routes";
import { AuthService } from "../app/services/auth.service";
import { Migrator } from "../database/migrator";

// The whole app on an in-memory SQLite database, wired by hand (no container).
async function buildApp() {
  const sql = new SQL(":memory:");
  await new Migrator(sql).run();
  const config = new AppConfig({});
  const authService = new AuthService(
    new UserRepository(sql),
    new AccessTokenRepository(sql),
    config,
  );
  const bearerAuth = new BearerAuthMiddleware(authService);
  const inertia = new InertiaMiddleware(config);
  return new Application(
    config,
    new ErrorHandler(),
    new AuthRoutes(new AuthController(authService), bearerAuth),
    new UserRoutes(new UserController(), bearerAuth),
    new PageRoutes(new PageController(inertia), inertia),
  ).build();
}

describe("API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  function post(path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  function me(token: string) {
    return app.request("/api/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  test("register, login, me, logout", async () => {
    const registered = await post("/api/v1/auth/register", {
      name: "Aung",
      email: "Aung@Example.com",
      password: "a-long-password",
    });
    expect(registered.status).toBe(201);

    const login = await post("/api/v1/auth/login", {
      email: "aung@example.com",
      password: "a-long-password",
    });
    expect(login.status).toBe(200);
    const { token } = await login.json();

    const profile = await me(token);
    expect(profile.status).toBe(200);
    const user = await profile.json();
    expect(user.email).toBe("aung@example.com");
    expect(user.passwordHash).toBeUndefined();

    expect((await post("/api/v1/auth/logout", {}, token)).status).toBe(204);
    expect((await me(token)).status).toBe(401);
  });

  test("invalid input gets 422 with details", async () => {
    const response = await post("/api/v1/auth/register", { name: "", email: "x", password: "1" });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.length).toBe(3);
  });

  test("me without a token gets 401", async () => {
    const response = await app.request("/api/v1/users/me");

    expect(response.status).toBe(401);
  });

  test("the OpenAPI spec lists every endpoint", async () => {
    const spec = await (await app.request("/api/v1/openapi.json")).json();

    expect(Object.keys(spec.paths).sort()).toEqual([
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/register",
      "/api/v1/users/me",
    ]);
  });

  test("a page is HTML on first visit and JSON on an Inertia visit", async () => {
    const first = await app.request("/login");
    expect(first.headers.get("Content-Type")).toContain("text/html");
    expect(await first.text()).toContain('data-page="app"');

    const next = await app.request("/login", {
      headers: { "X-Inertia": "true", "X-Inertia-Version": "dev" },
    });
    expect(next.headers.get("X-Inertia")).toBe("true");
    expect((await next.json()).component).toBe("Login");
  });
});
