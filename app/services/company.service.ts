import type { SQL } from "bun";
import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { AppError } from "../errors/app.error";
import { isUniqueViolation } from "../errors/unique-violation";
import type { Company } from "../models/company.model";
import type { Organization } from "../models/organization.model";
import type { User } from "../models/user.model";
import {
  type AdminActionEntry,
  AdminActionRepository,
} from "../repositories/admin-action.repository";
import { type CompanyProfileFields, CompanyRepository } from "../repositories/company.repository";
import type { RegisterInput } from "../schemas/auth.schema";
import type { UpdateCompanyInput, UpdateMyCompanyInput } from "../schemas/company.schema";
import type { Page, PageQuery } from "../schemas/page.schema";
import { AuthService, companyNameTaken } from "./auth.service";
import { Clock } from "./clock.service";
import { NotificationService } from "./notification.service";
import { OrderService } from "./order.service";
import { OrganizationService } from "./organization.service";

/**
 * What an admin can do with customer and supplier companies,
 * and what a user can do with their own company.
 */
@singleton()
export class CompanyService {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly authService: AuthService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
    private readonly orders: OrderService,
    private readonly adminActions: AdminActionRepository,
  ) {}

  /** What admins did while they acted as a customer, the newest first. For an admin. */
  listAdminActions(page: PageQuery): Promise<Page<AdminActionEntry>> {
    return this.adminActions.list(page);
  }

  /** `ungrouped` gives only the companies that are in no organization group. */
  list(type: Role, page: PageQuery, ungrouped = false): Promise<Page<Company>> {
    return this.companies.listByType(type, page, ungrouped);
  }

  /** The organization group of the company with its members, or `null`. */
  async groupOf(company: Company): Promise<Organization | null> {
    return company.organizationId ? this.organizations.get(company.organizationId) : null;
  }

  /** The company of the user. */
  async getMine(user: User): Promise<Company> {
    const company = await this.companies.findById(user.companyId);
    if (!company) {
      throw new AppError(404, ErrorCode.NotFound, "Company not found.");
    }
    return company;
  }

  /** Only the owner changes the name and the profile of their company. */
  async updateMine(user: User, input: UpdateMyCompanyInput): Promise<Company> {
    if (!user.isOwner) {
      throw new AppError(403, ErrorCode.Forbidden, "Only the owner can change the company.");
    }
    // Only the fields that were sent are saved. The rest stays as it is in the database.
    await this.saveProfile(user.companyId, input);
    return this.getMine(user);
  }

  /** Creates a company and its first user. A company that an admin creates is approved. */
  async create(input: RegisterInput): Promise<Company> {
    const user = await this.authService.createAccount(input);
    return this.find(user.companyId);
  }

  /**
   * An admin lets a supplier that signed up by itself into the catalog.
   * The supplier is told once. Approving again changes nothing.
   */
  async approve(id: string): Promise<Company> {
    const company = await this.find(id);
    if (!company.approvedAt) {
      await this.companies.transaction(this.approveInside.bind(this, id));
    }
    return this.find(id);
  }

  private async approveInside(id: string, db: SQL): Promise<void> {
    // Two admins can click at the same moment. Only the call that changed the row tells
    // the supplier, so the supplier is told once.
    if (!(await this.companies.approve(id, this.clock.timestamp(), db))) {
      return;
    }
    await this.notifications.notifyCompany(
      id,
      "Your company is approved. Customers can now see and order your items.",
      "/items",
      db,
    );
  }

  /**
   * Each part is saved alone. A change of the name never writes `disabled_at`.
   * The users of a disabled company cannot log in, so its waiting orders are cancelled
   * and the other company is told. Its accepted orders stay as they are: the admin can
   * cancel them from the project page.
   */
  async update(admin: User, id: string, input: UpdateCompanyInput): Promise<Company> {
    const company = await this.find(id);
    await this.saveProfile(id, { name: input.name });
    if (input.disabled === true) {
      await this.companies.disable(id, new Date().toISOString());
      await this.orders.cancelWaitingOf(company, admin.id);
    }
    if (input.disabled === false) {
      await this.companies.enable(id);
    }
    return this.find(id);
  }

  /** One customer or supplier company, for an admin. */
  get(id: string): Promise<Company> {
    return this.find(id);
  }

  /** The admin company cannot be managed here, so it counts as not found. */
  private async find(id: string): Promise<Company> {
    const company = await this.companies.findById(id);
    if (!company || company.type === Role.Admin) {
      throw new AppError(404, ErrorCode.NotFound, "Company not found.");
    }
    return company;
  }

  /** The UNIQUE index on the name key refuses a name of another company. It becomes a 409. */
  private async saveProfile(id: string, fields: CompanyProfileFields): Promise<void> {
    try {
      await this.companies.updateProfile(id, fields);
    } catch (error) {
      throw isUniqueViolation(error) ? companyNameTaken() : error;
    }
  }
}
