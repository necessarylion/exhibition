import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { ProjectController } from "../controllers/project.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { RoleGuard } from "../middleware/role-guard.middleware";
import { errorResponse } from "../schemas/error.schema";
import {
  AddAgainSchema,
  AddLineSchema,
  CreateProjectSchema,
  ProjectDetailSchema,
  ProjectLineParamSchema,
  ProjectListQuerySchema,
  ProjectOrderParamSchema,
  ProjectParamSchema,
  ProjectSchema,
  SendProjectSchema,
  UpdateLineSchema,
  UpdateProjectSchema,
} from "../schemas/project.schema";

@singleton()
export class ProjectRoutes {
  private readonly customerOnly = new RoleGuard([Role.Customer]);
  private readonly readers = new RoleGuard([Role.Customer, Role.Admin]);

  constructor(
    private readonly controller: ProjectController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const bearer = this.bearerAuth.handle.bind(this.bearerAuth);
    const customer = [bearer, this.customerOnly.handle.bind(this.customerOnly)];
    const reader = [bearer, this.readers.handle.bind(this.readers)];
    const security = [{ [BEARER_SCHEME]: [] }];
    const tags = ["Projects"];
    const projectResponse = {
      description: "The project.",
      content: { "application/json": { schema: ProjectSchema } },
    };
    const detailResponse = {
      description: "The project with its lines and its orders.",
      content: { "application/json": { schema: ProjectDetailSchema } },
    };
    const readErrors = {
      401: errorResponse("The token is missing, wrong or expired."),
      403: errorResponse("Only a customer or an admin can do this."),
    };
    const writeErrors = {
      401: errorResponse("The token is missing, wrong or expired."),
      403: errorResponse("Only a customer can do this."),
      404: errorResponse("The project does not exist, or it is not mine."),
    };
    const closed = errorResponse("The project is cancelled or done.");
    const invalid = errorResponse("The input is not valid.");

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/projects`,
        tags,
        summary: "List the projects of my company (customer) or of every company (admin)",
        security,
        middleware: reader,
        request: { query: ProjectListQuerySchema },
        responses: {
          200: {
            description:
              'The projects that match. The events to come are first, then the ones that are over. `X-Total-Count` has their number. `X-Counts` is JSON like `{"draft":2,"waiting":1,…,"totalCents":9000}`: the projects per status for the same search, and the sum of their order totals.',
            content: { "application/json": { schema: z.array(ProjectSchema) } },
          },
          ...readErrors,
          422: invalid,
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects`,
        tags,
        summary: "Create a project in my company (customer only)",
        security,
        middleware: customer,
        request: {
          body: {
            required: true,
            content: { "application/json": { schema: CreateProjectSchema } },
          },
        },
        responses: {
          201: projectResponse,
          401: writeErrors[401],
          403: writeErrors[403],
          422: invalid,
        },
      }),
      this.controller.create.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/projects/{id}`,
        tags,
        summary: "Get one project with its lines and its orders (its customer, or an admin)",
        security,
        middleware: reader,
        request: { params: ProjectParamSchema },
        responses: {
          200: detailResponse,
          ...readErrors,
          404: errorResponse("The project does not exist, or you cannot see it."),
        },
      }),
      this.controller.get.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/projects/{id}`,
        tags,
        summary: "Change one of my projects (customer only)",
        security,
        middleware: customer,
        request: {
          params: ProjectParamSchema,
          body: {
            required: true,
            content: { "application/json": { schema: UpdateProjectSchema } },
          },
        },
        responses: { 200: projectResponse, ...writeErrors, 409: closed, 422: invalid },
      }),
      this.controller.update.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects/{id}/lines`,
        tags,
        summary: "Add an item of my catalog to the project. The same item again adds to its line.",
        security,
        middleware: customer,
        request: {
          params: ProjectParamSchema,
          body: { required: true, content: { "application/json": { schema: AddLineSchema } } },
        },
        responses: {
          201: detailResponse,
          ...writeErrors,
          409: closed,
          422: errorResponse("The input is not valid, or the item has not enough stock."),
        },
      }),
      this.controller.addLine.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/projects/{id}/lines/{lineId}`,
        tags,
        summary: "Change the quantity of a line that is not sent yet",
        security,
        middleware: customer,
        request: {
          params: ProjectLineParamSchema,
          body: { required: true, content: { "application/json": { schema: UpdateLineSchema } } },
        },
        responses: {
          200: detailResponse,
          ...writeErrors,
          409: errorResponse("The line is in an order, or the project is cancelled or done."),
          422: errorResponse("The input is not valid, or the item has not enough stock."),
        },
      }),
      this.controller.updateLine.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "delete",
        path: `${API_PREFIX}/projects/{id}/lines/{lineId}`,
        tags,
        summary: "Remove a line that is not sent yet",
        security,
        middleware: customer,
        request: { params: ProjectLineParamSchema },
        responses: {
          200: detailResponse,
          ...writeErrors,
          409: errorResponse("The line is in an order, or the project is cancelled or done."),
        },
      }),
      this.controller.removeLine.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects/{id}/send`,
        tags,
        summary: "Send the new lines. It makes one order per company that owns the items.",
        security,
        middleware: customer,
        request: {
          params: ProjectParamSchema,
          body: { required: true, content: { "application/json": { schema: SendProjectSchema } } },
        },
        responses: {
          200: detailResponse,
          ...writeErrors,
          409: errorResponse(
            "There is nothing to send, an item is gone or has not enough stock, or the project is cancelled or done. No order is made.",
          ),
          422: invalid,
        },
      }),
      this.controller.send.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects/{id}/orders/{orderId}/add-again`,
        tags,
        summary: "Put the items of a rejected or cancelled order back as lines that are not sent",
        description:
          "A line that is there already only grows to the quantity of the order, so calling it twice changes nothing more. An item that is not in the catalog any more, or is not free on the dates, is left out and named in `notAdded`.",
        security,
        middleware: customer,
        request: { params: ProjectOrderParamSchema },
        responses: {
          200: {
            description: "The project, and the items that could not be added.",
            content: { "application/json": { schema: AddAgainSchema } },
          },
          ...writeErrors,
          409: errorResponse(
            "The order is not rejected or cancelled, or the project is cancelled or done.",
          ),
          422: invalid,
        },
      }),
      this.controller.addAgain.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects/{id}/cancel`,
        tags,
        summary: "Cancel the project and its pending orders. Not after an order was accepted.",
        security,
        middleware: customer,
        request: { params: ProjectParamSchema },
        responses: {
          200: detailResponse,
          ...writeErrors,
          409: errorResponse("An order is accepted, or the project is cancelled or done."),
        },
      }),
      this.controller.cancel.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/projects/{id}/done`,
        tags,
        summary: "Mark a confirmed project as done",
        security,
        middleware: customer,
        request: { params: ProjectParamSchema },
        responses: {
          200: detailResponse,
          ...writeErrors,
          409: errorResponse("The project is not confirmed."),
        },
      }),
      this.controller.markDone.bind(this.controller),
    );
  }
}
