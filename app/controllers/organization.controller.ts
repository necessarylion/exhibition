import type { Context } from "hono";
import { singleton } from "tsyringe";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type {
  OrganizationCompanyParam,
  OrganizationInput,
  OrganizationListQuery,
  OrganizationParam,
} from "../schemas/organization.schema";
import { OrganizationService } from "../services/organization.service";

type CreateContext = Context<
  AppEnv,
  string,
  { in: { json: OrganizationInput }; out: { json: OrganizationInput } }
>;
type ListContext = Context<
  AppEnv,
  string,
  { in: { query: OrganizationListQuery }; out: { query: OrganizationListQuery } }
>;
type OneContext = Context<
  AppEnv,
  string,
  { in: { param: OrganizationParam }; out: { param: OrganizationParam } }
>;
type RenameContext = Context<
  AppEnv,
  string,
  {
    in: { param: OrganizationParam; json: OrganizationInput };
    out: { param: OrganizationParam; json: OrganizationInput };
  }
>;
type CompanyContext = Context<
  AppEnv,
  string,
  { in: { param: OrganizationCompanyParam }; out: { param: OrganizationCompanyParam } }
>;

@singleton()
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  async list(c: ListContext) {
    const result = [];
    for (const organization of await this.organizationService.list(c.req.valid("query").q)) {
      result.push(organization.toPublic());
    }
    return c.json(result, 200);
  }

  async get(c: OneContext) {
    const organization = await this.organizationService.get(c.req.valid("param").id);
    return c.json(organization.toPublic(), 200);
  }

  async create(c: CreateContext) {
    const organization = await this.organizationService.create(c.req.valid("json").name);
    return c.json(organization.toPublic(), 201);
  }

  async rename(c: RenameContext) {
    const organization = await this.organizationService.rename(
      c.req.valid("param").id,
      c.req.valid("json").name,
    );
    return c.json(organization.toPublic(), 200);
  }

  async remove(c: OneContext) {
    await this.organizationService.remove(c.req.valid("param").id);
    return c.body(null, 204);
  }

  async addCompany(c: CompanyContext) {
    const { id, companyId } = c.req.valid("param");
    return c.json((await this.organizationService.addCompany(id, companyId)).toPublic(), 200);
  }

  async removeCompany(c: CompanyContext) {
    const { id, companyId } = c.req.valid("param");
    return c.json((await this.organizationService.removeCompany(id, companyId)).toPublic(), 200);
  }
}
