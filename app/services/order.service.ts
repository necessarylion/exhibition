import type { SQL } from "bun";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { OrderStatus } from "../constants/order.constants";
import { Role } from "../constants/role.constants";
import { AppError } from "../errors/app.error";
import type { Company } from "../models/company.model";
import type { CancelledBy, Order } from "../models/order.model";
import type { User } from "../models/user.model";
import { ItemRepository } from "../repositories/item.repository";
import { OrderRepository } from "../repositories/order.repository";
import { ProjectRepository } from "../repositories/project.repository";
import type { OrderListQuery } from "../schemas/order.schema";
import type { Page } from "../schemas/page.schema";
import { NotificationService } from "./notification.service";

/** The words the pages use for a status. A pending order is "waiting" everywhere. */
const STATUS_WORDS: Record<OrderStatus, string> = {
  pending: "waiting",
  accepted: "accepted",
  rejected: "rejected",
  cancelled: "cancelled",
  completed: "completed",
};

/** The side of an order: the company that owns the items, or the company that asked. */
type Side = "supplier" | "customer";

@singleton()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly projects: ProjectRepository,
    private readonly items: ItemRepository,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * A customer gets the orders of their projects. A supplier, and also an admin, gets the
   * orders for the items of their company. An admin sees every other order inside its project.
   */
  async list(user: User, query: OrderListQuery): Promise<Page<Order>> {
    const side =
      user.role === Role.Customer
        ? { customerCompanyId: user.companyId }
        : { supplierCompanyId: user.companyId };
    return this.orders.listPage({ ...side, status: query.status, q: query.q }, query);
  }

  /**
   * The two companies of an order and an admin can read it.
   * The company that answers a waiting order (and an admin) also gets, per line, how many
   * are free on the dates of the order. So they know before they click "Accept".
   */
  async get(user: User, id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    const canSee =
      order &&
      (user.role === Role.Admin ||
        order.supplierCompanyId === user.companyId ||
        order.customerCompanyId === user.companyId);
    // An order of other companies counts as not found. This does not reveal that it exists.
    if (!order || !canSee) {
      throw new AppError(404, ErrorCode.NotFound, "Order not found.");
    }
    if (order.status === OrderStatus.Pending && order.customerCompanyId !== user.companyId) {
      await this.attachAvailable(order);
    }
    return order;
  }

  private async attachAvailable(order: Order, db?: SQL): Promise<void> {
    const itemIds: string[] = [];
    for (const line of order.lines) {
      itemIds.push(line.itemId);
    }
    const reserved = await this.items.reserved(itemIds, order.reservedFrom, order.event.endsOn, db);
    for (const line of order.lines) {
      line.available =
        line.stock === null ? null : Math.max(0, line.stock - (reserved.get(line.itemId) ?? 0));
    }
  }

  /** The supplier says yes. The items are then held for the dates of the order. */
  async accept(user: User, id: string): Promise<Order> {
    const order = await this.findForSide(user, id, "supplier");
    // A supplier that waits for approval has no item in a catalog, so it has no order.
    // This guard keeps it so if that ever changes.
    if (!user.companyApprovedAt) {
      throw new AppError(
        403,
        ErrorCode.NotApproved,
        "Your company waits for approval. You cannot accept orders yet.",
      );
    }
    return this.projects.locked(order.projectId, this.acceptLocked.bind(this, user, id));
  }

  async reject(user: User, id: string, reason: string): Promise<Order> {
    const order = await this.findForSide(user, id, "supplier");
    return this.projects.locked(order.projectId, this.rejectLocked.bind(this, user, id, reason));
  }

  /**
   * The customer takes a pending request back. The supplier cancels an order they already
   * accepted, and must say why. An admin cancels a pending or accepted order of any
   * company, and must say why: this is how a stuck order is solved.
   * The items are free again for these dates.
   */
  async cancel(user: User, id: string, reason?: string): Promise<Order> {
    const order = await this.get(user, id);
    const bySupplier = order.supplierCompanyId === user.companyId;
    if (user.role === Role.Admin || bySupplier) {
      if (!reason) {
        throw new AppError(422, ErrorCode.ValidationFailed, "Write a reason.");
      }
      const by: CancelledBy = user.role === Role.Admin ? "admin" : "supplier";
      return this.projects.locked(
        order.projectId,
        this.cancelWithReasonLocked.bind(this, user.id, id, reason, by),
      );
    }
    if (order.customerCompanyId !== user.companyId) {
      throw this.forbidden();
    }
    return this.projects.locked(order.projectId, this.cancelLocked.bind(this, id));
  }

  /**
   * An admin disabled the company: its users cannot log in, so nobody would answer its
   * waiting orders. They are cancelled and the other company is told. Accepted orders stay
   * as they are. Returns how many were cancelled.
   */
  async cancelWaitingOf(company: Company, adminUserId: string): Promise<number> {
    const who = company.type === Role.Customer ? "customer" : "supplier";
    const waiting = await this.orders.list({
      eitherCompanyId: company.id,
      status: OrderStatus.Pending,
    });
    let cancelled = 0;
    for (const order of waiting) {
      try {
        await this.projects.locked(
          order.projectId,
          this.cancelWithReasonLocked.bind(
            this,
            adminUserId,
            order.id,
            `The ${who} is not available any more.`,
            "admin",
          ),
        );
        cancelled += 1;
      } catch (error) {
        // The order was answered or cancelled a moment ago. Then there is nothing to do.
        if (!(error instanceof AppError) || error.status !== 409) {
          throw error;
        }
      }
    }
    return cancelled;
  }

  async complete(user: User, id: string): Promise<Order> {
    const order = await this.findForSide(user, id, "supplier");
    return this.projects.locked(order.projectId, this.completeLocked.bind(this, id));
  }

  /**
   * The stock of an item is never lowered. An accepted or completed order holds its
   * quantity from its setup day (or first day) to its last day. This order fits when
   * the stock minus what other orders hold on its dates is enough.
   */
  private async acceptLocked(user: User, id: string, db: SQL): Promise<Order> {
    const itemIds: string[] = [];
    for (const line of (await this.findInStatus(id, OrderStatus.Pending, db)).lines) {
      itemIds.push(line.itemId);
    }
    // Lock first, then read. A second accept for the same item waits here, and then
    // sees what this one took.
    await this.items.lock(itemIds, db);
    const order = await this.findInStatus(id, OrderStatus.Pending, db);
    await this.attachAvailable(order, db);
    for (const line of order.lines) {
      if (line.available !== null && line.quantity > line.available) {
        throw new AppError(
          409,
          ErrorCode.NotEnoughStock,
          `"${line.itemName}" has only ${line.available} available for these dates. The order asks for ${line.quantity}.`,
        );
      }
    }
    order.status = OrderStatus.Accepted;
    order.decidedAt = new Date().toISOString();
    order.decidedBy = user.id;
    await this.orders.update(order, db);
    await this.tellCustomer(order, "accepted", "", db);
    return order;
  }

  private async rejectLocked(user: User, id: string, reason: string, db: SQL): Promise<Order> {
    const order = await this.findInStatus(id, OrderStatus.Pending, db);
    order.status = OrderStatus.Rejected;
    order.rejectReason = reason;
    order.decidedAt = new Date().toISOString();
    order.decidedBy = user.id;
    await this.orders.update(order, db);
    await this.tellCustomer(order, "rejected", " Read the reason and pick other items.", db);
    return order;
  }

  private async cancelLocked(id: string, db: SQL): Promise<Order> {
    const order = await this.findInStatus(id, OrderStatus.Pending, db);
    order.status = OrderStatus.Cancelled;
    order.cancelledBy = "customer";
    await this.orders.update(order, db);
    await this.notifications.notifyCompany(
      order.supplierCompanyId,
      `${order.customerCompanyName} cancelled order ${order.number} for ${order.event.name}.`,
      `/orders/${order.id}`,
      db,
    );
    return order;
  }

  /**
   * A supplier cancels an order it accepted. An admin cancels a waiting or an accepted one.
   * The other company (for an admin: both companies) is told, with the reason on the order.
   */
  private async cancelWithReasonLocked(
    userId: string,
    id: string,
    reason: string,
    by: CancelledBy,
    db: SQL,
  ): Promise<Order> {
    const from: OrderStatus[] =
      by === "admin" ? [OrderStatus.Pending, OrderStatus.Accepted] : [OrderStatus.Accepted];
    const order = await this.findInStatus(id, from, db);
    order.status = OrderStatus.Cancelled;
    order.rejectReason = reason;
    order.cancelledBy = by;
    order.decidedAt = new Date().toISOString();
    order.decidedBy = userId;
    await this.orders.update(order, db);
    if (by === "supplier") {
      await this.tellCustomer(order, "cancelled", " Read the reason.", db);
      return order;
    }
    const text = `The platform admin cancelled order ${order.number} for ${order.event.name}. Read the reason.`;
    const link = `/orders/${order.id}`;
    await this.notifications.notifyCompany(order.customerCompanyId, text, link, db);
    await this.notifications.notifyCompany(order.supplierCompanyId, text, link, db);
    return order;
  }

  private async completeLocked(id: string, db: SQL): Promise<Order> {
    const order = await this.findInStatus(id, OrderStatus.Accepted, db);
    order.status = OrderStatus.Completed;
    order.completedAt = new Date().toISOString();
    await this.orders.update(order, db);
    await this.tellCustomer(order, "completed", "", db);
    return order;
  }

  /** Every user of the customer company learns what the supplier did with the order. */
  private async tellCustomer(order: Order, did: string, more: string, db: SQL): Promise<void> {
    await this.notifications.notifyCompany(
      order.customerCompanyId,
      `${order.supplierCompanyName} ${did} order ${order.number} for ${order.event.name}.${more}`,
      `/orders/${order.id}`,
      db,
    );
  }

  /** Inside the lock: the order as it is now. It must be in a status the change starts from. */
  private async findInStatus(
    id: string,
    status: OrderStatus | readonly OrderStatus[],
    db: SQL,
  ): Promise<Order> {
    const allowed = typeof status === "string" ? [status] : status;
    const order = await this.orders.findById(id, db);
    if (!order || !allowed.includes(order.status)) {
      const names: string[] = [];
      for (const one of allowed) {
        names.push(STATUS_WORDS[one]);
      }
      throw new AppError(
        409,
        ErrorCode.InvalidStatus,
        `Only an order that is ${names.join(" or ")} can do this. This order is ${order ? STATUS_WORDS[order.status] : "gone"}.`,
      );
    }
    return order;
  }

  /** The order, when the user can see it and their company is on the given side of it. */
  private async findForSide(user: User, id: string, side: Side): Promise<Order> {
    const order = await this.get(user, id);
    const companyId = side === "supplier" ? order.supplierCompanyId : order.customerCompanyId;
    if (companyId !== user.companyId) {
      throw this.forbidden();
    }
    return order;
  }

  private forbidden(): AppError {
    return new AppError(403, ErrorCode.Forbidden, "Your company cannot do this.");
  }
}
