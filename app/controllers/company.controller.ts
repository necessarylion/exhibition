import type { Context } from "hono";
import { singleton } from "tsyringe";
import { COUNTS_HEADER, TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type { Company } from "../models/company.model";
import type { RegisterInput } from "../schemas/auth.schema";
import type {
  CompanyListQuery,
  CompanyParam,
  UpdateCompanyInput,
  UpdateMyCompanyInput,
} from "../schemas/company.schema";
import type { PageQuery } from "../schemas/page.schema";
import { AuthService } from "../services/auth.service";
import { CompanyService } from "../services/company.service";
import { toAuthResponse } from "./auth.controller";

type ListContext = Context<
  AppEnv,
  string,
  { in: { query: CompanyListQuery }; out: { query: CompanyListQuery } }
>;
type ActionsContext = Context<
  AppEnv,
  string,
  { in: { query: PageQuery }; out: { query: PageQuery } }
>;
type CreateContext = Context<
  AppEnv,
  string,
  { in: { json: RegisterInput }; out: { json: RegisterInput } }
>;
type UpdateContext = Context<
  AppEnv,
  string,
  {
    in: { param: CompanyParam; json: UpdateCompanyInput };
    out: { param: CompanyParam; json: UpdateCompanyInput };
  }
>;
type ApproveContext = Context<
  AppEnv,
  string,
  { in: { param: CompanyParam }; out: { param: CompanyParam } }
>;
type UpdateMineContext = Context<
  AppEnv,
  string,
  { in: { json: UpdateMyCompanyInput }; out: { json: UpdateMyCompanyInput } }
>;

@singleton()
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly authService: AuthService,
  ) {}

  async list(c: ListContext) {
    const query = c.req.valid("query");
    const page = await this.companyService.list(query.type, query, query.ungrouped === "true");
    const result = [];
    for (const company of page.rows) {
      result.push(company.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    c.header(COUNTS_HEADER, JSON.stringify(page.counts ?? {}));
    return c.json(result, 200);
  }

  async adminActions(c: ActionsContext) {
    const page = await this.companyService.listAdminActions(c.req.valid("query"));
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    return c.json(page.rows, 200);
  }

  /** A token to work as the owner of a customer company. See `AuthService.impersonate`. */
  async impersonate(c: ApproveContext) {
    const result = await this.authService.impersonate(c.get("user"), c.req.valid("param").id);
    return c.json(toAuthResponse(result), 200);
  }

  async mine(c: Context<AppEnv>) {
    return c.json(await this.profile(await this.companyService.getMine(c.get("user"))), 200);
  }

  async updateMine(c: UpdateMineContext) {
    const company = await this.companyService.updateMine(c.get("user"), c.req.valid("json"));
    return c.json(await this.profile(company), 200);
  }

  async get(c: ApproveContext) {
    return c.json((await this.companyService.get(c.req.valid("param").id)).toPublic(), 200);
  }

  async approve(c: ApproveContext) {
    const company = await this.companyService.approve(c.req.valid("param").id);
    return c.json(company.toPublic(), 200);
  }

  /** My company with its organization group. The members of the group show only their names. */
  private async profile(company: Company) {
    const organization = await this.companyService.groupOf(company);
    return { ...company.toProfile(), organization: organization?.toMember() ?? null };
  }

  async create(c: CreateContext) {
    const company = await this.companyService.create(c.req.valid("json"));
    return c.json(company.toPublic(), 201);
  }

  async update(c: UpdateContext) {
    const company = await this.companyService.update(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(company.toPublic(), 200);
  }
}
