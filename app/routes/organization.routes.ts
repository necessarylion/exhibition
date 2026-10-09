import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { OrganizationController } from "../controllers/organization.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { RoleGuard } from "../middleware/role-guard.middleware";
import { errorResponse } from "../schemas/error.schema";
import {
  OrganizationCompanyParamSchema,
  OrganizationInputSchema,
  OrganizationListQuerySchema,
  OrganizationParamSchema,
  OrganizationSchema,
} from "../schemas/organization.schema";

/** Organization groups. Every route is for an admin only. */
@singleton()
export class OrganizationRoutes {
  private readonly adminOnly = new RoleGuard([Role.Admin]);

  constructor(
    private readonly controller: OrganizationController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const middleware = [
      this.bearerAuth.handle.bind(this.bearerAuth),
      this.adminOnly.handle.bind(this.adminOnly),
    ];
    const security = [{ [BEARER_SCHEME]: [] }];
    const tags = ["Groups"];
    const one = {
      description: "The group with its companies.",
      content: { "application/json": { schema: OrganizationSchema } },
    };
    const body = {
      required: true,
      content: { "application/json": { schema: OrganizationInputSchema } },
    };
    const authErrors = {
      401: errorResponse("The token is missing, wrong or expired."),
      403: errorResponse("Only an admin can do this."),
    };
    const notFound = errorResponse("The group does not exist.");
    const invalid = errorResponse("The input is not valid.");
    const nameTaken = errorResponse("Another group has this name.");

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/organizations`,
        tags,
        summary: "List the organization groups with their companies (admin only)",
        security,
        middleware,
        request: { query: OrganizationListQuerySchema },
        responses: {
          200: {
            description:
              "The groups, sorted by name. `q` gives the groups with that text in their name or in the name of one of their companies.",
            content: { "application/json": { schema: z.array(OrganizationSchema) } },
          },
          ...authErrors,
          422: invalid,
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/organizations`,
        tags,
        summary: "Create a group (admin only)",
        security,
        middleware,
        request: { body },
        responses: { 201: one, ...authErrors, 409: nameTaken, 422: invalid },
      }),
      this.controller.create.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/organizations/{id}`,
        tags,
        summary: "Get one group with its companies (admin only)",
        security,
        middleware,
        request: { params: OrganizationParamSchema },
        responses: { 200: one, ...authErrors, 404: notFound, 422: invalid },
      }),
      this.controller.get.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/organizations/{id}`,
        tags,
        summary: "Rename a group (admin only)",
        security,
        middleware,
        request: { params: OrganizationParamSchema, body },
        responses: { 200: one, ...authErrors, 404: notFound, 409: nameTaken, 422: invalid },
      }),
      this.controller.rename.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "delete",
        path: `${API_PREFIX}/organizations/{id}`,
        tags,
        summary: "Delete a group. Its companies stay and only leave the group (admin only)",
        security,
        middleware,
        request: { params: OrganizationParamSchema },
        responses: {
          204: { description: "The group is deleted." },
          ...authErrors,
          404: notFound,
          422: invalid,
        },
      }),
      this.controller.remove.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "put",
        path: `${API_PREFIX}/organizations/{id}/companies/{companyId}`,
        tags,
        summary: "Add a customer company to a group (admin only)",
        security,
        middleware,
        request: { params: OrganizationCompanyParamSchema },
        responses: {
          200: one,
          ...authErrors,
          404: errorResponse("The group or the company does not exist."),
          409: errorResponse("The company is not a customer, or it is in another group."),
          422: invalid,
        },
      }),
      this.controller.addCompany.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "delete",
        path: `${API_PREFIX}/organizations/{id}/companies/{companyId}`,
        tags,
        summary: "Remove a company from a group (admin only)",
        security,
        middleware,
        request: { params: OrganizationCompanyParamSchema },
        responses: {
          200: one,
          ...authErrors,
          404: errorResponse("The group does not exist, or the company is not in it."),
          422: invalid,
        },
      }),
      this.controller.removeCompany.bind(this.controller),
    );
  }
}
