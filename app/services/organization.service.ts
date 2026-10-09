import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { AppError } from "../errors/app.error";
import { isForeignKeyViolation, isUniqueViolation } from "../errors/unique-violation";
import { Organization } from "../models/organization.model";
import { CompanyRepository } from "../repositories/company.repository";
import { OrganizationRepository } from "../repositories/organization.repository";
import { Clock } from "./clock.service";

/**
 * Organization groups. Only an admin manages them (the routes check the role).
 * A group holds customer companies only, and a company is in at most one group.
 * The companies of a group share their items for free. `ItemRepository` has that rule.
 */
@singleton()
export class OrganizationService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly companies: CompanyRepository,
    private readonly clock: Clock,
  ) {}

  /** `q` gives only the groups with this text in their name or in the name of a company. */
  async list(q?: string): Promise<Organization[]> {
    const organizations = await this.organizations.list(q);
    for (const organization of organizations) {
      organization.companies = await this.companies.listByOrganization(organization.id);
    }
    return organizations;
  }

  /** The group with its companies. */
  async get(id: string): Promise<Organization> {
    const organization = await this.organizations.findById(id);
    if (!organization) {
      throw this.notFound();
    }
    organization.companies = await this.companies.listByOrganization(id);
    return organization;
  }

  async create(name: string): Promise<Organization> {
    const organization = new Organization(crypto.randomUUID(), name, this.clock.timestamp());
    await this.save(this.organizations.create(organization));
    return organization;
  }

  async rename(id: string, name: string): Promise<Organization> {
    await this.get(id);
    await this.save(this.organizations.rename(id, name));
    return this.get(id);
  }

  /** The companies stay. They only leave the group. Lines that are shared already stay too. */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.organizations.delete(id);
  }

  async addCompany(id: string, companyId: string): Promise<Organization> {
    await this.get(id);
    const company = await this.companies.findById(companyId);
    if (!company) {
      throw new AppError(404, ErrorCode.NotFound, "Company not found.");
    }
    if (company.type !== Role.Customer) {
      throw new AppError(409, ErrorCode.NotACustomer, "Only a customer company can be in a group.");
    }
    try {
      await this.companies.joinOrganization(companyId, id);
    } catch (error) {
      // Another admin deleted the group at this moment.
      throw isForeignKeyViolation(error) ? this.notFound() : error;
    }
    // Read again. The update does nothing when the company is in another group.
    const saved = await this.companies.findById(companyId);
    if (saved?.organizationId !== id) {
      throw new AppError(
        409,
        ErrorCode.AlreadyInGroup,
        `${company.name} is already in another group. Remove it from that group first.`,
      );
    }
    return this.get(id);
  }

  async removeCompany(id: string, companyId: string): Promise<Organization> {
    await this.get(id);
    const company = await this.companies.findById(companyId);
    if (!company || company.organizationId !== id) {
      throw new AppError(404, ErrorCode.NotFound, "This company is not in the group.");
    }
    await this.companies.leaveOrganization(companyId);
    return this.get(id);
  }

  private notFound(): AppError {
    return new AppError(404, ErrorCode.NotFound, "Group not found.");
  }

  /** The UNIQUE index on the name is the guard. Its error becomes a 409. */
  private async save(write: Promise<void>): Promise<void> {
    try {
      await write;
    } catch (error) {
      throw isUniqueViolation(error)
        ? new AppError(409, ErrorCode.GroupNameTaken, "Another group has this name.")
        : error;
    }
  }
}
