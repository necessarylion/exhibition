import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { OrderController } from "../controllers/order.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { errorResponse } from "../schemas/error.schema";
import {
  CancelOrderSchema,
  OrderDetailSchema,
  OrderListQuerySchema,
  OrderParamSchema,
  OrderSchema,
  RejectOrderSchema,
} from "../schemas/order.schema";

// No RoleGuard here. Who can do what depends on the companies of the order, not on the role:
// the admin company can be the supplier of an order. `OrderService` checks it.
@singleton()
export class OrderRoutes {
  constructor(
    private readonly controller: OrderController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const middleware = [this.bearerAuth.handle.bind(this.bearerAuth)];
    const security = [{ [BEARER_SCHEME]: [] }];
    const tags = ["Orders"];
    const detailResponse = {
      description: "The order with its lines, the event and the contact of the customer.",
      content: { "application/json": { schema: OrderDetailSchema } },
    };
    const unauthorized = errorResponse("The token is missing, wrong or expired.");
    const changeErrors = {
      401: unauthorized,
      403: errorResponse("My company is not on the right side of this order."),
      404: errorResponse("The order does not exist, or you cannot see it."),
      409: errorResponse("The order is not in the right status for this."),
    };

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/orders`,
        tags,
        summary:
          "List the orders for the items of my company (supplier, admin), or of my projects (customer)",
        security,
        middleware,
        request: { query: OrderListQuerySchema },
        responses: {
          200: {
            description:
              'The orders that match. The newest is first. `X-Total-Count` has their number. `X-Counts` is JSON like `{"pending":2,…,"totalCents":9000}`: the orders per status for the same search, and the sum of the waiting, accepted and completed ones that match.',
            content: { "application/json": { schema: z.array(OrderSchema) } },
          },
          401: unauthorized,
          422: errorResponse("The input is not valid."),
        },
      }),
      this.controller.list.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/orders/{id}`,
        tags,
        summary: "Get one order: as its supplier, as its customer, or as an admin",
        security,
        middleware,
        request: { params: OrderParamSchema },
        responses: { 200: detailResponse, 401: unauthorized, 404: changeErrors[404] },
      }),
      this.controller.get.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/orders/{id}/accept`,
        tags,
        summary: "Accept a pending order (its supplier). The items are held for its dates.",
        security,
        middleware,
        request: { params: OrderParamSchema },
        responses: {
          200: detailResponse,
          ...changeErrors,
          409: errorResponse(
            "The order is not pending, or an item is not free on the dates of the order.",
          ),
        },
      }),
      this.controller.accept.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/orders/{id}/reject`,
        tags,
        summary: "Reject a pending order with a reason (its supplier)",
        security,
        middleware,
        request: {
          params: OrderParamSchema,
          body: { required: true, content: { "application/json": { schema: RejectOrderSchema } } },
        },
        responses: {
          200: detailResponse,
          ...changeErrors,
          422: errorResponse("The reason is missing or too long."),
        },
      }),
      this.controller.reject.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/orders/{id}/cancel`,
        tags,
        summary:
          "Cancel an order: its customer while it is pending, its supplier after accepting it, or an admin while it is pending or accepted (both with a reason)",
        security,
        middleware,
        request: {
          params: OrderParamSchema,
          body: { required: false, content: { "application/json": { schema: CancelOrderSchema } } },
        },
        responses: {
          200: detailResponse,
          ...changeErrors,
          422: errorResponse("The supplier or the admin did not send a reason."),
        },
      }),
      this.controller.cancel.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/orders/{id}/complete`,
        tags,
        summary: "Mark an accepted order as completed (its supplier)",
        security,
        middleware,
        request: { params: OrderParamSchema },
        responses: { 200: detailResponse, ...changeErrors },
      }),
      this.controller.complete.bind(this.controller),
    );
  }
}
