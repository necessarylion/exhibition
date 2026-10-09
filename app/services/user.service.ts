import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { AppError } from "../errors/app.error";
import type { Company } from "../models/company.model";
import type { User } from "../models/user.model";
import { AccessTokenRepository } from "../repositories/access-token.repository";
import { CompanyRepository } from "../repositories/company.repository";
import { UserRepository } from "../repositories/user.repository";
import type { CreateUserInput } from "../schemas/auth.schema";
import type { Page, PageQuery } from "../schemas/page.schema";
import { AuthService } from "./auth.service";

/**
 * The users of a company.
 * - Every user can see the users of their own company. An admin can see every company.
 * - Only the owner adds and removes users of their company. An admin can do it for the
 *   customer and supplier companies.
 * - The owner can never be removed.
 * - The same people can set a new password for a user of the company.
 */
// ponytail: the owner cannot be changed. Add a "make owner" action when a company asks for it.
@singleton()
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly companies: CompanyRepository,
    private readonly tokens: AccessTokenRepository,
    private readonly authService: AuthService,
  ) {}

  async list(actor: User, page: PageQuery, companyId?: string): Promise<Page<User>> {
    const company = await this.findCompany(actor, companyId);
    return this.users.listByCompany(company.id, page);
  }

  /** Changes my own name. */
  async rename(actor: User, name: string): Promise<User> {
    await this.users.updateName(actor.id, name);
    return (await this.users.findById(actor.id)) ?? actor;
  }

  async create(actor: User, input: CreateUserInput): Promise<User> {
    const company = await this.findCompany(actor, input.companyId);
    this.assertCanManage(actor, company.id);
    return this.authService.addUser(input, company);
  }

  /** Sets a new password for another user. That user is logged out everywhere. */
  async resetPassword(actor: User, id: string, newPassword: string): Promise<void> {
    const target = await this.findManaged(actor, id);
    if (target.id === actor.id) {
      throw new AppError(
        403,
        ErrorCode.Forbidden,
        "Change your own password with your current password.",
      );
    }
    await this.authService.resetPassword(target.id, newPassword);
  }

  async remove(actor: User, id: string): Promise<void> {
    const target = await this.findManaged(actor, id);
    if (target.isOwner) {
      throw new AppError(409, ErrorCode.CannotRemoveOwner, "The owner cannot be removed.");
    }
    await this.tokens.deleteByUser(target.id);
    await this.users.delete(target.id);
  }

  /** The user, when the actor can see them and can manage the users of their company. */
  private async findManaged(actor: User, id: string): Promise<User> {
    const target = await this.users.findById(id);
    // A user of another company counts as not found. This does not reveal that it exists.
    if (!target || !this.canSee(actor, target.companyId)) {
      throw new AppError(404, ErrorCode.NotFound, "User not found.");
    }
    this.assertCanManage(actor, target.companyId);
    return target;
  }

  private canSee(actor: User, companyId: string): boolean {
    return actor.role === Role.Admin || actor.companyId === companyId;
  }

  private assertCanManage(actor: User, companyId: string): void {
    const ownsIt = actor.isOwner && actor.companyId === companyId;
    const adminOfAnother = actor.role === Role.Admin && actor.companyId !== companyId;
    if (!ownsIt && !adminOfAnother) {
      throw new AppError(403, ErrorCode.Forbidden, "Only the owner can manage the users.");
    }
  }

  /** No id means the company of the actor. */
  private async findCompany(actor: User, companyId = actor.companyId): Promise<Company> {
    const company = this.canSee(actor, companyId) ? await this.companies.findById(companyId) : null;
    if (!company) {
      throw new AppError(404, ErrorCode.NotFound, "Company not found.");
    }
    return company;
  }
}
