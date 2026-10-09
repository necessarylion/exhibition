import type { Context } from "hono";
import { singleton } from "tsyringe";
import { COUNTS_HEADER, TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type {
  CancelOrderInput,
  OrderListQuery,
  OrderParam,
  RejectOrderInput,
} from "../schemas/order.schema";
import { OrderService } from "../services/order.service";

type Input<T extends object> = Context<AppEnv, string, { in: T; out: T }>;
type ListContext = Input<{ query: OrderListQuery }>;
type OrderContext = Input<{ param: OrderParam }>;
type CancelContext = Input<{ param: OrderParam; json: CancelOrderInput }>;
type RejectContext = Input<{ param: OrderParam; json: RejectOrderInput }>;

@singleton()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  async list(c: ListContext) {
    const page = await this.orderService.list(c.get("user"), c.req.valid("query"));
    const result = [];
    for (const order of page.rows) {
      result.push(order.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    c.header(COUNTS_HEADER, JSON.stringify(page.counts ?? {}));
    return c.json(result, 200);
  }

  async get(c: OrderContext) {
    const order = await this.orderService.get(c.get("user"), c.req.valid("param").id);
    return c.json(order.toDetail(), 200);
  }

  async accept(c: OrderContext) {
    const order = await this.orderService.accept(c.get("user"), c.req.valid("param").id);
    return c.json(order.toDetail(), 200);
  }

  async reject(c: RejectContext) {
    const order = await this.orderService.reject(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json").reason,
    );
    return c.json(order.toDetail(), 200);
  }

  async cancel(c: CancelContext) {
    const order = await this.orderService.cancel(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json").reason,
    );
    return c.json(order.toDetail(), 200);
  }

  async complete(c: OrderContext) {
    const order = await this.orderService.complete(c.get("user"), c.req.valid("param").id);
    return c.json(order.toDetail(), 200);
  }
}
