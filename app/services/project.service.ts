import type { SQL, TransactionSQL } from "bun";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { FIRST_ORDER_NUMBER, ORDER_NUMBER_PREFIX, OrderStatus } from "../constants/order.constants";
import {
  LineState,
  MAX_LINE_QUANTITY,
  MAX_ORDER_NUMBER_TRIES,
  OPEN_PROJECT_STATUSES,
  ProjectSort,
} from "../constants/project.constants";
import { Role } from "../constants/role.constants";
import { DAY_MS } from "../constants/time.constants";
import { AppError } from "../errors/app.error";
import { isUniqueViolation } from "../errors/unique-violation";
import type { Item } from "../models/item.model";
import { Order } from "../models/order.model";
import { OrderLine } from "../models/order-line.model";
import { Project } from "../models/project.model";
import type { ProjectLine } from "../models/project-line.model";
import type { User } from "../models/user.model";
import { CompanyRepository } from "../repositories/company.repository";
import { ItemRepository } from "../repositories/item.repository";
import { OrderRepository } from "../repositories/order.repository";
import { type ProjectFilter, ProjectRepository } from "../repositories/project.repository";
import type { Page } from "../schemas/page.schema";
import type {
  AddLineInput,
  CreateProjectInput,
  ProjectListQuery,
  SendProjectInput,
  UpdateProjectInput,
} from "../schemas/project.schema";
import { Clock } from "./clock.service";
import { NotificationService } from "./notification.service";

/** A project with its lines and its orders. The orders have their lines. */
export interface ProjectDetail {
  project: Project;
  lines: ProjectLine[];
  orders: Order[];
}

/** The answer of "Add these items again": the project, and the items that could not be added. */
export interface AddAgainResult extends ProjectDetail {
  /** One plain sentence per item that was left out. */
  notAdded: string[];
}

/** The platform admin who acts as the customer, or `null`. Its id and name go on what is made. */
type ActingAdmin = User["actingAdmin"];

/** The facts of the event. They cannot change while an order waits or is accepted. */
const EVENT_FIELDS = [
  "startsOn",
  "endsOn",
  "setupOn",
  "venue",
  "city",
  "hall",
  "boothNumber",
  "boothWidthCm",
  "boothDepthCm",
] as const;

/** What the availability check needs to know of an item. */
interface StockOf {
  id: string;
  name: string;
  stock: number | null;
  /** The type of the company that owns the item. */
  companyType: Role;
}

/** A line that is ready to send, with its item as it is now. */
interface SendEntry {
  line: ProjectLine;
  item: Item;
}

@singleton()
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly orders: OrderRepository,
    private readonly items: ItemRepository,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    private readonly companies: CompanyRepository,
  ) {}

  /**
   * A customer gets the projects of their company. An admin gets every project.
   * The events to come are first, the next one at the top. Then the events that are over.
   */
  list(user: User, query: ProjectListQuery): Promise<Page<Project>> {
    let statuses: ProjectFilter["statuses"];
    if (query.status) {
      statuses = [query.status];
    } else if (query.open === "true") {
      statuses = OPEN_PROJECT_STATUSES;
    }
    return this.projects.list(
      {
        companyId: user.role === Role.Admin ? undefined : user.companyId,
        statuses,
        q: query.q,
        hasWaitingOrders: query.hasWaitingOrders === "true",
        sort: ProjectSort.Next,
        today: this.earliestStart(),
      },
      query,
    );
  }

  /** A customer sees the projects of their company. An admin sees every project. */
  async get(user: User, id: string): Promise<ProjectDetail> {
    const project = await this.projects.findById(id);
    if (!project || (project.companyId !== user.companyId && user.role !== Role.Admin)) {
      throw this.notFound();
    }
    return this.detail(project);
  }

  async create(user: User, input: CreateProjectInput): Promise<Project> {
    // Only a new project is checked. An old project can still be changed after its start.
    if (input.startsOn < this.earliestStart()) {
      throw this.invalid("The start date cannot be in the past.");
    }
    const project = new Project(
      crypto.randomUUID(),
      user.companyId,
      user.companyName,
      input.name,
      input.startsOn,
      input.endsOn,
      user.id,
      this.clock.timestamp(),
    );
    // Never from the request: only the token says that an admin acts as this customer.
    project.createdByAdminId = user.actingAdmin?.id ?? null;
    project.createdByAdminName = user.actingAdmin?.name ?? null;
    this.apply(project, input);
    await this.projects.create(project);
    return project;
  }

  async update(user: User, id: string, input: UpdateProjectInput): Promise<Project> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.updateLocked.bind(this, id, input));
  }

  /**
   * Adds an item of my catalog to the project. When a line of this item is not sent yet,
   * the quantity goes on that line.
   */
  async addLine(user: User, id: string, input: AddLineInput): Promise<ProjectDetail> {
    await this.findMine(user, id);
    const item = await this.items.findInCatalog(user.companyId, input.itemId);
    if (!item) {
      throw new AppError(404, ErrorCode.NotFound, "Item not found.");
    }
    return this.projects.locked(id, this.addLineLocked.bind(this, id, item, input.quantity));
  }

  async updateLine(user: User, id: string, lineId: string, quantity: number) {
    await this.findMine(user, id);
    return this.projects.locked(id, this.changeLineLocked.bind(this, id, lineId, quantity));
  }

  async removeLine(user: User, id: string, lineId: string): Promise<ProjectDetail> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.changeLineLocked.bind(this, id, lineId, null));
  }

  /** Makes one order per owner company from the lines that are not sent yet. */
  async send(user: User, id: string, input: SendProjectInput): Promise<ProjectDetail> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.sendLocked.bind(this, id, input, user.actingAdmin));
  }

  /**
   * After a reject or a cancel: puts the items of that order back as lines that are not
   * sent. A line that is there already only grows to the quantity of the order, so a second
   * click changes nothing. An item that cannot be added is named in `notAdded`.
   */
  async addAgain(user: User, id: string, orderId: string): Promise<AddAgainResult> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.addAgainLocked.bind(this, id, orderId));
  }

  private async addAgainLocked(id: string, orderId: string, db: SQL): Promise<AddAgainResult> {
    const project = await this.findOpen(id, db);
    const order = await this.orders.findById(orderId, db);
    if (!order || order.projectId !== id) {
      throw new AppError(404, ErrorCode.NotFound, "Order not found.");
    }
    if (order.status !== OrderStatus.Rejected && order.status !== OrderStatus.Cancelled) {
      throw new AppError(
        409,
        ErrorCode.InvalidStatus,
        "Only the items of a rejected or cancelled order can be added again.",
      );
    }
    const notAdded: string[] = [];
    for (const line of order.lines) {
      const item = await this.items.findInCatalog(project.companyId, line.itemId, db);
      if (!item) {
        notAdded.push(`"${line.itemName}" is not in the catalog any more.`);
        continue;
      }
      const open = await this.projects.findOpenLine(id, item.id, db);
      const wanted = Math.max(open?.quantity ?? 0, line.quantity);
      try {
        await this.assertAvailable(project, item, wanted, 422, db);
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }
        notAdded.push(error.message);
        continue;
      }
      if (open) {
        await this.projects.setLineQuantity(open.id, wanted, db);
      } else {
        await this.projects.addLine(id, item.id, wanted, db);
      }
    }
    return { ...(await this.detail(project, db)), notAdded };
  }

  /** Cancels the project and its pending orders. Not possible after a supplier said yes. */
  async cancel(user: User, id: string): Promise<ProjectDetail> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.cancelLocked.bind(this, id));
  }

  async markDone(user: User, id: string): Promise<ProjectDetail> {
    await this.findMine(user, id);
    return this.projects.locked(id, this.doneLocked.bind(this, id));
  }

  private async updateLocked(id: string, input: UpdateProjectInput, db: SQL): Promise<Project> {
    const project = await this.findOpen(id, db);
    if (project.eventLocked && this.changesEvent(project, input)) {
      throw new AppError(
        409,
        ErrorCode.ProjectLocked,
        "An order of this project waits for an answer or is accepted. The dates, the place and the booth cannot change now. Cancel the waiting orders first, or ask the supplier.",
      );
    }
    this.apply(project, input);
    await this.projects.update(project, db);
    return project;
  }

  private async addLineLocked(id: string, item: Item, quantity: number, db: SQL) {
    const project = await this.findOpen(id, db);
    const open = await this.projects.findOpenLine(id, item.id, db);
    const total = (open?.quantity ?? 0) + quantity;
    await this.assertAvailable(project, item, total, 422, db);
    if (open) {
      await this.projects.setLineQuantity(open.id, total, db);
    } else {
      await this.projects.addLine(id, item.id, total, db);
    }
    return this.detail(project, db);
  }

  /** Sets the quantity of a line. `null` removes the line. A sent line cannot change. */
  private async changeLineLocked(id: string, lineId: string, quantity: number | null, db: SQL) {
    const project = await this.findOpen(id, db);
    const line = await this.projects.findLine(id, lineId, db);
    if (!line) {
      throw new AppError(404, ErrorCode.NotFound, "Line not found.");
    }
    if (line.state === LineState.Sent) {
      throw new AppError(409, ErrorCode.LineSent, "This line is in an order. It cannot change.");
    }
    if (quantity === null) {
      await this.projects.removeLine(line.id, db);
    } else {
      // A shared line stays when the company leaves its group, but it cannot grow or
      // shrink any more: that item is not shared with this company now. It can be removed.
      if (
        line.state === LineState.Shared &&
        !(await this.items.findInCatalog(project.companyId, line.itemId, db))
      ) {
        throw new AppError(
          409,
          ErrorCode.ItemUnavailable,
          `"${line.itemName}" is not shared with your company any more. Keep the line as it is, or remove it.`,
        );
      }
      const item = {
        id: line.itemId,
        name: line.itemName,
        stock: line.stock,
        companyType: line.ownerCompanyType,
      };
      await this.assertAvailable(project, item, quantity, 422, db);
      await this.projects.setLineQuantity(line.id, quantity, db);
    }
    return this.detail(project, db);
  }

  private async sendLocked(
    id: string,
    input: SendProjectInput,
    actingAdmin: ActingAdmin,
    db: TransactionSQL,
  ): Promise<ProjectDetail> {
    const project = await this.findOpen(id, db);
    let totalCents = 0;
    // The lines to send, grouped by the company that owns the item.
    const groups = new Map<string, SendEntry[]>();
    for (const line of await this.projects.listLines(id, db)) {
      // Own and shared lines are free. They are never in an order.
      if (line.state !== LineState.NotSent) {
        continue;
      }
      // Check again now. The item can be hidden, or be taken by another order, since it was added.
      const item = await this.items.findInCatalog(project.companyId, line.itemId, db);
      if (!item) {
        throw new AppError(
          409,
          ErrorCode.ItemUnavailable,
          `"${line.itemName}" is not in the catalog any more. Remove it from the project.`,
        );
      }
      await this.assertAvailable(project, item, line.quantity, 409, db);
      totalCents += item.priceCents * line.quantity;
      const entries = groups.get(item.companyId) ?? [];
      entries.push({ line, item });
      groups.set(item.companyId, entries);
    }
    if (groups.size === 0) {
      throw new AppError(409, ErrorCode.NothingToSend, "There is no new item to send.");
    }
    // An admin can disable a company at this moment. Lock the companies of this send and
    // check again, so no waiting order is made for a company that nobody can log in to.
    if (!(await this.companies.lockEnabled([project.companyId, ...groups.keys()], db))) {
      throw new AppError(
        409,
        ErrorCode.ItemUnavailable,
        "An item is not in the catalog any more. Load the page again.",
      );
    }
    // The customer agreed to the total on the send page. A price can change at any moment.
    if (totalCents !== input.expectedTotalCents) {
      throw new AppError(
        409,
        ErrorCode.PricesChanged,
        "Prices changed. Check the new total and send again.",
      );
    }
    for (const entries of groups.values()) {
      await this.createOrder(project, entries, input.note ?? "", actingAdmin, db);
    }
    return this.detail(project, db);
  }

  /**
   * One order for one owner company. The lines keep the name, category, SKU, unit and price
   * of now. The order also keeps its own copy of the event facts.
   */
  private async createOrder(
    project: Project,
    entries: SendEntry[],
    note: string,
    actingAdmin: ActingAdmin,
    db: TransactionSQL,
  ) {
    const orderId = crypto.randomUUID();
    const lines: OrderLine[] = [];
    let totalCents = 0;
    let supplierId = "";
    let supplierName = "";
    for (const { line, item } of entries) {
      const lineTotalCents = item.priceCents * line.quantity;
      totalCents += lineTotalCents;
      supplierId = item.companyId;
      supplierName = item.companyName;
      lines.push(
        new OrderLine(
          crypto.randomUUID(),
          orderId,
          item.id,
          item.name,
          item.unit,
          item.priceCents,
          line.quantity,
          lineTotalCents,
          item.category,
          item.sku,
        ),
      );
    }
    const order = new Order(
      orderId,
      await this.newOrderNumber(db, 0),
      project.companyId,
      project.companyName,
      supplierId,
      supplierName,
      note,
      totalCents,
      this.clock.timestamp(),
      {
        id: project.id,
        name: project.name,
        venue: project.venue,
        city: project.city,
        hall: project.hall,
        boothNumber: project.boothNumber,
        boothWidthCm: project.boothWidthCm,
        boothDepthCm: project.boothDepthCm,
        startsOn: project.startsOn,
        endsOn: project.endsOn,
        setupOn: project.setupOn,
        notes: project.notes,
      },
    );
    order.createdByAdminId = actingAdmin?.id ?? null;
    order.createdByAdminName = actingAdmin?.name ?? null;
    await this.saveOrder(order, db);
    for (const line of lines) {
      await this.orders.addLine(line, db);
    }
    for (const { line } of entries) {
      await this.projects.setLineOrder(line.id, orderId, db);
    }
    await this.notifications.notifyCompany(
      supplierId,
      `${project.companyName} sent order ${order.number} for ${project.name}.`,
      `/orders/${orderId}`,
      db,
    );
  }

  /**
   * Two sends at the same moment can get the same number. The UNIQUE index stops the
   * second one, and the order is saved again with the next number.
   */
  private async saveOrder(order: Order, db: TransactionSQL): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.orders.create(order, db);
        return;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_ORDER_NUMBER_TRIES) {
          throw error;
        }
        order.number = await this.newOrderNumber(db, attempt);
      }
    }
  }

  /**
   * A short number that is easy to say on the phone, like "ORD-1048": the orders are
   * counted, and the first one is 1001. An order is never deleted, so the count only grows.
   */
  async newOrderNumber(db: SQL, attempt: number): Promise<string> {
    return `${ORDER_NUMBER_PREFIX}${FIRST_ORDER_NUMBER + (await this.orders.count(db)) + attempt}`;
  }

  private async cancelLocked(id: string, db: SQL): Promise<ProjectDetail> {
    const project = await this.findOpen(id, db);
    if (project.hasAcceptedOrder) {
      throw new AppError(
        409,
        ErrorCode.InvalidStatus,
        "A supplier already accepted an order. The project cannot be cancelled.",
      );
    }
    // The suppliers that still wait for this project are told.
    for (const order of await this.orders.list(
      { projectId: id, status: OrderStatus.Pending },
      db,
    )) {
      await this.notifications.notifyCompany(
        order.supplierCompanyId,
        `${order.customerCompanyName} cancelled order ${order.number} for ${order.event.name}.`,
        `/orders/${order.id}`,
        db,
      );
    }
    await this.orders.cancelPendingOfProject(id, db);
    await this.projects.setCancelled(id, new Date().toISOString(), db);
    return this.detail(project, db);
  }

  /**
   * A project can be done when it has an item, no order waits and every item was sent
   * (or is an own or a shared item). So a project with only free items can be done too.
   */
  private async doneLocked(id: string, db: SQL): Promise<ProjectDetail> {
    const project = await this.findOpen(id, db);
    if (project.pendingOrderCount > 0) {
      throw this.notReady("An order still waits for an answer. Wait for it, or cancel it first.");
    }
    const lines = await this.projects.listLines(id, db);
    if (lines.length === 0) {
      throw this.notReady("This project has no items. Add an item first, or cancel the project.");
    }
    for (const line of lines) {
      if (line.state === LineState.NotSent) {
        throw this.notReady(`"${line.itemName}" is not sent yet. Send it or remove it first.`);
      }
    }
    await this.projects.setDone(id, new Date().toISOString(), db);
    return this.detail(project, db);
  }

  private notReady(message: string): AppError {
    return new AppError(409, ErrorCode.InvalidStatus, message);
  }

  private changesEvent(project: Project, input: UpdateProjectInput): boolean {
    for (const field of EVENT_FIELDS) {
      if (input[field] !== undefined && input[field] !== project[field]) {
        return true;
      }
    }
    return false;
  }

  // ponytail: the server does not know the time zone of the user. "Yesterday in UTC" lets
  // every user pick their own today. Send the time zone with the request if a day matters.
  private earliestStart(): string {
    return new Date(this.clock.now() - DAY_MS).toISOString().slice(0, 10);
  }

  /** Puts the input on the project. A field that is not in the input stays as it is. */
  private apply(project: Project, input: UpdateProjectInput): void {
    // The fields have the same name on the project. `null` clears an optional field.
    Object.assign(project, input);
    // Dates are YYYY-MM-DD text. Text in this form compares like a date.
    if (project.endsOn < project.startsOn) {
      throw this.invalid("The end date cannot be before the start date.");
    }
    if (project.setupOn !== null && project.setupOn > project.startsOn) {
      throw this.invalid("The setup date cannot be after the start date.");
    }
  }

  /**
   * The stock of an item is the total the owner has. An accepted or completed order holds
   * its quantity for its own dates. So what is free depends on the dates of the project.
   * An item of a customer company is not checked: it is an own item or an item that the
   * organization group shares, and the companies of a group arrange that between them.
   */
  // ponytail: a pending order holds nothing. Two projects can ask for the same last piece.
  // The first accept wins and the second one gets a 409. Hold on send if suppliers ask for it.
  private async assertAvailable(
    project: Project,
    item: StockOf,
    quantity: number,
    status: 409 | 422,
    db: SQL,
  ): Promise<void> {
    if (quantity > MAX_LINE_QUANTITY) {
      throw this.invalid(`One line can have up to ${MAX_LINE_QUANTITY} of an item.`);
    }
    if (item.stock === null || item.companyType === Role.Customer) {
      return;
    }
    const reserved = await this.items.reserved([item.id], project.reservedFrom, project.endsOn, db);
    const available = Math.max(0, item.stock - (reserved.get(item.id) ?? 0));
    if (quantity > available) {
      throw new AppError(
        status,
        ErrorCode.NotEnoughStock,
        available === 0
          ? `"${item.name}" is not available for your dates.`
          : `"${item.name}" has only ${available} available for your dates. You asked for ${quantity}.`,
      );
    }
  }

  /** Reads the project again with fresh counts and loads its lines and orders. */
  private async detail(project: Project, db?: SQL): Promise<ProjectDetail> {
    const fresh = (await this.projects.findById(project.id, db)) ?? project;
    const lines = await this.projects.listLines(project.id, db);
    const itemIds: string[] = [];
    for (const line of lines) {
      itemIds.push(line.itemId);
    }
    const reserved = await this.items.reserved(itemIds, fresh.reservedFrom, fresh.endsOn, db);
    for (const line of lines) {
      line.reserved = reserved.get(line.itemId) ?? 0;
    }
    const orders = await this.orders.list({ projectId: project.id }, db);
    await this.orders.attachLines(orders, db);
    return { project: fresh, lines, orders };
  }

  /** Inside the lock: the project as it is now. A cancelled or done project is read only. */
  private async findOpen(id: string, db: SQL): Promise<Project> {
    const project = await this.projects.findById(id, db);
    if (!project) {
      throw this.notFound();
    }
    if (project.isClosed) {
      throw new AppError(
        409,
        ErrorCode.ProjectClosed,
        `This project is ${project.cancelledAt ? "cancelled" : "done"}. It cannot change.`,
      );
    }
    return project;
  }

  private async findMine(user: User, id: string): Promise<Project> {
    const project = await this.projects.findById(id);
    // A project of another company counts as not found. This does not reveal that it exists.
    if (!project || project.companyId !== user.companyId) {
      throw this.notFound();
    }
    return project;
  }

  private notFound(): AppError {
    return new AppError(404, ErrorCode.NotFound, "Project not found.");
  }

  private invalid(message: string): AppError {
    return new AppError(422, ErrorCode.ValidationFailed, message);
  }
}
