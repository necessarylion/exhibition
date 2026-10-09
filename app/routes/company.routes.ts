import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { CompanyController } from "../controllers/company.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { NotWhileActing } from "../middleware/not-while-acting.middleware";
import { RoleGuard } from "../middleware/role-guard.middleware";
import { AuthSchema, RegisterSchema } from "../schemas/auth.schema";
import {
  AdminActionSchema,
  CompanyListQuerySchema,
  CompanyParamSchema,
  CompanyProfileSchema,
  CompanySchema,
  UpdateCompanySchema,
  UpdateMyCompanySchema,
} from "../schemas/company.schema";
import { errorResponse } from "../schemas/error.schema";
import { PageQuerySchema } from "../schemas/page.schema";

@singleton()
export class CompanyRoutes {
  private readonly adminOnly = new RoleGuard([Role.Admin]);

  constructor(
    private readonly controller: CompanyController,
    private readonly bearerAuth: BearerAuthMiddleware,
    private readonly notWhileActing: NotWhileActing,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const middleware = [
      this.bearerAuth.handle.bind(this.bearerAuth),
      this.adminOnly.handle.bind(this.adminOnly),
    ];
    const security = [{ [BEARER_SCHEME]: [] }];
    const companyResponse = {
      description: "The company.",
      content: { "application/json": { schema: CompanySchema } },
    };
    const authErrors = {
      401: errorResponse("The token is missing, wrong or expired."),
      403: errorResponse("Only an admin can do this."),
    };

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/companies`,
        tags: ["Companies"],
        summary: "List the customer or the supplier companies (admin only)",
        security,
        middleware,
        request: { query: CompanyListQuerySchema },
        responses: {
          200: {
            description:
              'The companies that match, sorted by name. `q` searches the name, the email and the group. `X-Total-Count` has their number. `X-Counts` is JSON like `{"waiting":1,"disabled":0}`: how many of them wait for approval and how many are disabled.',
            content: { "application/json": { schema: z.array(CompanySchema) } },
          },
          ...authErrors,
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/admin-actions`,
        tags: ["Companies"],
        summary: "List what admins did while they acted as a customer (admin only)",
        security,
        middleware,
        request: { query: PageQuerySchema },
        responses: {
          200: {
            description:
              "The log, the newest first. `X-Total-Count` has the number of rows. Rows older than one year are deleted.",
            content: { "application/json": { schema: z.array(AdminActionSchema) } },
          },
          ...authErrors,
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.adminActions.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/companies`,
        tags: ["Companies"],
        summary: "Create a company and its first user (admin only)",
        security,
        middleware,
        request: {
          body: { required: true, content: { "application/json": { schema: RegisterSchema } } },
        },
        responses: {
          201: companyResponse,
          ...authErrors,
          409: errorResponse("The email is already registered, or the company name is taken."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.create.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/companies/{id}`,
        tags: ["Companies"],
        summary: "Get one customer or supplier company (admin only)",
        security,
        middleware,
        request: { params: CompanyParamSchema },
        responses: {
          200: companyResponse,
          ...authErrors,
          404: errorResponse("The company does not exist."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.get.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/companies/{id}`,
        tags: ["Companies"],
        summary: "Rename, disable or enable a company (admin only)",
        security,
        middleware,
        request: {
          params: CompanyParamSchema,
          body: {
            required: true,
            content: { "application/json": { schema: UpdateCompanySchema } },
          },
        },
        responses: {
          200: companyResponse,
          ...authErrors,
          404: errorResponse("The company does not exist."),
          409: errorResponse("Another company has this name."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.update.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/companies/{id}/approve`,
        tags: ["Companies"],
        summary: "Approve a supplier that signed up by itself (admin only)",
        description:
          "Its items are then in the catalog, and its users get a notification. Approving again changes nothing.",
        security,
        middleware,
        request: { params: CompanyParamSchema },
        responses: {
          200: companyResponse,
          ...authErrors,
          404: errorResponse("The company does not exist."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.approve.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/companies/{id}/impersonate`,
        tags: ["Companies"],
        summary: "Act as a customer company (admin only)",
        description:
          "Gives a token for the OWNER of the customer company. It lasts 2 hours and works like a login of that customer: it cannot reach an admin endpoint. `GET /users/me` then has `actingAdmin`. The start is logged and the users of the company get a notification. End it with `POST /auth/stop-impersonating`.",
        security,
        // The acting check comes first, so an admin who already acts gets its own message.
        middleware: [
          this.bearerAuth.handle.bind(this.bearerAuth),
          this.notWhileActing.handle.bind(this.notWhileActing),
          this.adminOnly.handle.bind(this.adminOnly),
        ],
        request: { params: CompanyParamSchema },
        responses: {
          200: {
            description: "The owner of the company and a Bearer token to act as them.",
            content: { "application/json": { schema: AuthSchema } },
          },
          ...authErrors,
          404: errorResponse("The company does not exist."),
          409: errorResponse("The company is not a customer, is disabled, or has no owner."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.impersonate.bind(this.controller),
    );

    // My own company. Every role can read it. Only its owner can change it.
    const bearer = [this.bearerAuth.handle.bind(this.bearerAuth)];
    const profileResponse = {
      description: "My company.",
      content: { "application/json": { schema: CompanyProfileSchema } },
    };

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/company`,
        tags: ["Companies"],
        summary: "Get my company and its profile",
        security,
        middleware: bearer,
        responses: { 200: profileResponse, 401: authErrors[401] },
      }),
      this.controller.mine.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/company`,
        tags: ["Companies"],
        summary: "Change the name and the profile of my company (owner only)",
        security,
        middleware: bearer,
        request: {
          body: {
            required: true,
            content: { "application/json": { schema: UpdateMyCompanySchema } },
          },
        },
        responses: {
          200: profileResponse,
          401: authErrors[401],
          403: errorResponse("Only the owner can change the company."),
          409: errorResponse("Another company has this name."),
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.updateMine.bind(this.controller),
    );
  }
}
