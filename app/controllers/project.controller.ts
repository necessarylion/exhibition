import type { Context } from "hono";
import { singleton } from "tsyringe";
import { COUNTS_HEADER, TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type {
  AddLineInput,
  CreateProjectInput,
  ProjectLineParam,
  ProjectListQuery,
  ProjectOrderParam,
  ProjectParam,
  SendProjectInput,
  UpdateLineInput,
  UpdateProjectInput,
} from "../schemas/project.schema";
import { type ProjectDetail, ProjectService } from "../services/project.service";

type Input<T extends object> = Context<AppEnv, string, { in: T; out: T }>;
type ListContext = Input<{ query: ProjectListQuery }>;
type ProjectContext = Input<{ param: ProjectParam }>;
type CreateContext = Input<{ json: CreateProjectInput }>;
type UpdateContext = Input<{ param: ProjectParam; json: UpdateProjectInput }>;
type AddLineContext = Input<{ param: ProjectParam; json: AddLineInput }>;
type UpdateLineContext = Input<{ param: ProjectLineParam; json: UpdateLineInput }>;
type LineContext = Input<{ param: ProjectLineParam }>;
type OrderOfProjectContext = Input<{ param: ProjectOrderParam }>;
type SendContext = Input<{ param: ProjectParam; json: SendProjectInput }>;

@singleton()
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  async list(c: ListContext) {
    const query = c.req.valid("query");
    const page = await this.projectService.list(c.get("user"), query);
    const result = [];
    for (const project of page.rows) {
      result.push(project.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    c.header(COUNTS_HEADER, JSON.stringify(page.counts ?? {}));
    return c.json(result, 200);
  }

  async addAgain(c: OrderOfProjectContext) {
    const { id, orderId } = c.req.valid("param");
    const result = await this.projectService.addAgain(c.get("user"), id, orderId);
    return c.json({ ...this.toPublic(result), notAdded: result.notAdded }, 200);
  }

  async get(c: ProjectContext) {
    const detail = await this.projectService.get(c.get("user"), c.req.valid("param").id);
    return c.json(this.toPublic(detail), 200);
  }

  async create(c: CreateContext) {
    const project = await this.projectService.create(c.get("user"), c.req.valid("json"));
    return c.json(project.toPublic(), 201);
  }

  async update(c: UpdateContext) {
    const project = await this.projectService.update(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(project.toPublic(), 200);
  }

  async addLine(c: AddLineContext) {
    const detail = await this.projectService.addLine(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(this.toPublic(detail), 201);
  }

  async updateLine(c: UpdateLineContext) {
    const { id, lineId } = c.req.valid("param");
    const { quantity } = c.req.valid("json");
    const detail = await this.projectService.updateLine(c.get("user"), id, lineId, quantity);
    return c.json(this.toPublic(detail), 200);
  }

  async removeLine(c: LineContext) {
    const { id, lineId } = c.req.valid("param");
    const detail = await this.projectService.removeLine(c.get("user"), id, lineId);
    return c.json(this.toPublic(detail), 200);
  }

  async send(c: SendContext) {
    const detail = await this.projectService.send(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(this.toPublic(detail), 200);
  }

  async cancel(c: ProjectContext) {
    const detail = await this.projectService.cancel(c.get("user"), c.req.valid("param").id);
    return c.json(this.toPublic(detail), 200);
  }

  async markDone(c: ProjectContext) {
    const detail = await this.projectService.markDone(c.get("user"), c.req.valid("param").id);
    return c.json(this.toPublic(detail), 200);
  }

  private toPublic(detail: ProjectDetail) {
    const lines = [];
    for (const line of detail.lines) {
      lines.push(line.toPublic());
    }
    const orders = [];
    for (const order of detail.orders) {
      orders.push(order.toPublicWithLines());
    }
    return { project: detail.project.toPublic(), lines, orders };
  }
}
