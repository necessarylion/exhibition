import { randomBytes } from "node:crypto";
import type { SQL } from "bun";
import { singleton } from "tsyringe";
import { AppConfig } from "../config/app.config";
import { ACTING_TOKEN_TTL_MS, ErrorCode, TOKEN_BYTES } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { DAY_MS } from "../constants/time.constants";
import { AppError } from "../errors/app.error";
import { isUniqueViolation } from "../errors/unique-violation";
import { AccessToken } from "../models/access-token.model";
import { Company } from "../models/company.model";
import { User } from "../models/user.model";
import { AccessTokenRepository } from "../repositories/access-token.repository";
import { AdminActionRepository } from "../repositories/admin-action.repository";
import { CompanyRepository } from "../repositories/company.repository";
import { UserRepository } from "../repositories/user.repository";
import type {
  AdminInput,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
} from "../schemas/auth.schema";
import { Clock } from "./clock.service";
import { NotificationService } from "./notification.service";

export function companyNameTaken(): AppError {
  return new AppError(409, ErrorCode.CompanyNameTaken, "Another company has this name.");
}

export interface AuthResult {
  user: User;
  /** The plain token. It is shown once. Only its hash is stored. */
  token: string;
  expiresAt: string;
}

@singleton()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly companies: CompanyRepository,
    private readonly tokens: AccessTokenRepository,
    private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    private readonly adminActions: AdminActionRepository,
  ) {}

  /**
   * Sign up. It creates a new company and its first user.
   * A supplier that signs up by itself waits for an admin. A customer is approved at once.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    return this.issueToken(await this.createAccount(input, input.role !== Role.Supplier));
  }

  /**
   * Creates a company and its first user. It does not log the user in.
   * `approved` is true when an admin creates the company.
   */
  async createAccount(input: RegisterInput, approved = true): Promise<User> {
    await this.assertEmailIsFree(input.email);
    const company = new Company(
      crypto.randomUUID(),
      input.companyName,
      input.role,
      this.clock.timestamp(),
    );
    company.approvedAt = approved ? company.createdAt : null;
    // Hash before the transaction starts. Hashing is slow and the transaction must be short.
    const user = await this.buildUser(input, company, true);
    return this.companies.transaction(this.saveAccount.bind(this, company, user));
  }

  /** Used by the create-admin script only. There is no public way to become an admin. */
  async registerAdmin(input: AdminInput): Promise<User> {
    await this.assertEmailIsFree(input.email);
    let company = await this.companies.findFirstByType(Role.Admin);
    // The first admin is the owner of the admin company.
    const isOwner = !company;
    if (!company) {
      // "Exhibition Platform accepted order …" tells a customer who it was. The plain name
      // of the app would read like the app itself did it.
      company = new Company(
        crypto.randomUUID(),
        `${this.config.appName} Platform`,
        Role.Admin,
        this.clock.timestamp(),
      );
      company.approvedAt = company.createdAt;
      await this.saveCompany(company);
    }
    return this.saveUser(await this.buildUser(input, company, isOwner));
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    // Always verify a hash, so an unknown email takes the same time as a wrong password.
    const hash = user ? user.passwordHash : await this.getDummyHash();
    const passwordMatches = await Bun.password.verify(input.password, hash);
    if (!user || !passwordMatches) {
      throw new AppError(401, ErrorCode.InvalidCredentials, "Email or password is wrong.");
    }
    if (user.companyDisabledAt) {
      throw new AppError(
        403,
        ErrorCode.CompanyDisabled,
        "This account is disabled. Ask the platform admin.",
      );
    }
    return this.issueToken(user);
  }

  /** Ends this session. An admin who logs out also stops every "act as a customer" session. */
  async logout(user: User, token: string): Promise<void> {
    await this.tokens.deleteByHash(this.hashToken(token));
    if (!user.actingAdmin && user.role === Role.Admin) {
      await this.tokens.deleteByImpersonator(user.id);
    }
  }

  /**
   * A platform admin starts to act as a customer company: a token for the OWNER of that
   * company, marked with the id of the admin. It lasts 2 hours. With it the app works as
   * for the customer, and the admin endpoints are closed (the role of the token is customer).
   * The start is written to the log, and the users of the company are told.
   */
  async impersonate(admin: User, companyId: string): Promise<AuthResult> {
    // The route lets only a real admin session in. This keeps it so if a route ever forgets.
    if (admin.role !== Role.Admin || admin.actingAdmin) {
      throw new AppError(403, ErrorCode.Forbidden, "Only a platform admin can do this.");
    }
    const company = await this.companies.findById(companyId);
    // The admin company cannot be managed, so it counts as not found.
    if (!company || company.type === Role.Admin) {
      throw new AppError(404, ErrorCode.NotFound, "Company not found.");
    }
    if (company.type !== Role.Customer) {
      throw new AppError(409, ErrorCode.NotACustomer, "You can act only as a customer company.");
    }
    if (company.disabledAt) {
      throw new AppError(
        409,
        ErrorCode.CompanyDisabled,
        "This company is disabled. Enable it first.",
      );
    }
    const owner = await this.users.findOwner(companyId);
    if (!owner) {
      throw new AppError(409, ErrorCode.InvalidStatus, "This company has no owner to act as.");
    }
    owner.actingAdmin = { id: admin.id, name: admin.name };
    return this.companies.transaction(this.startActing.bind(this, admin, owner));
  }

  private async startActing(admin: User, owner: User, db: SQL): Promise<AuthResult> {
    const result = await this.issueToken(owner, admin.id, db);
    await this.adminActions.create(
      {
        adminUserId: admin.id,
        adminName: admin.name,
        companyId: owner.companyId,
        userId: owner.id,
        action: "impersonate",
        createdAt: this.clock.timestamp(),
      },
      db,
    );
    await this.notifications.notifyCompany(
      owner.companyId,
      `${admin.name} (platform admin) worked in your account.`,
      "/projects",
      db,
    );
    return result;
  }

  /** Ends the "act as a customer" session of this token. The own session of the admin stays. */
  async stopImpersonating(user: User, token: string): Promise<void> {
    if (!user.actingAdmin) {
      throw new AppError(409, ErrorCode.InvalidStatus, "You are not acting as a customer.");
    }
    await this.tokens.deleteByHash(this.hashToken(token));
  }

  /** Logs the user out on every device. */
  async logoutAll(user: User): Promise<void> {
    await this.tokens.deleteByUser(user.id);
  }

  /** Changes my password. Every other device is logged out. `token` is the one in use. */
  async changePassword(user: User, token: string, input: ChangePasswordInput): Promise<void> {
    if (!(await Bun.password.verify(input.currentPassword, user.passwordHash))) {
      throw new AppError(422, ErrorCode.WrongPassword, "The current password is wrong.");
    }
    if (input.newPassword === input.currentPassword) {
      throw new AppError(
        422,
        ErrorCode.SamePassword,
        "The new password must be different from the current one.",
      );
    }
    await this.users.updatePasswordHash(user.id, await Bun.password.hash(input.newPassword));
    await this.tokens.deleteOthersOfUser(user.id, this.hashToken(token));
  }

  /** Sets a new password for a user and logs them out everywhere. The caller checks access. */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await this.users.updatePasswordHash(userId, await Bun.password.hash(newPassword));
    await this.tokens.deleteByUser(userId);
  }

  /** Returns the user that owns the token. Throws 401 when the token is not valid. */
  async authenticate(token: string): Promise<User> {
    const tokenHash = this.hashToken(token);
    const record = await this.tokens.findByHash(tokenHash);
    if (!record) {
      throw this.unauthorized();
    }
    if (record.isExpired(new Date())) {
      await this.tokens.deleteByHash(tokenHash);
      throw this.unauthorized();
    }
    const user = await this.users.findById(record.userId);
    // A disabled company loses access at once, also with a token it got before.
    if (!user || user.companyDisabledAt) {
      // A login token works again when the company is enabled. An acting token does not:
      // the admin starts again then.
      if (record.impersonatorId) {
        await this.tokens.deleteByHash(tokenHash);
      }
      throw this.unauthorized();
    }
    if (record.impersonatorId) {
      // The token of an admin who acts as a customer. It is good only while the admin is
      // still an admin that can log in, and the user is still a customer.
      const admin = await this.users.findById(record.impersonatorId);
      if (
        !admin ||
        admin.role !== Role.Admin ||
        admin.companyDisabledAt ||
        user.role !== Role.Customer
      ) {
        await this.tokens.deleteByHash(tokenHash);
        throw this.unauthorized();
      }
      user.actingAdmin = { id: admin.id, name: admin.name };
    }
    return user;
  }

  /** Adds a user to a company that already exists. It does not log the user in. */
  async addUser(input: AdminInput, company: Company): Promise<User> {
    await this.assertEmailIsFree(input.email);
    return this.saveUser(await this.buildUser(input, company, false));
  }

  /** The fast check. Two requests at the same moment can both pass it; `saveUser` stops them. */
  private async assertEmailIsFree(email: string): Promise<void> {
    if (await this.users.findByEmail(email)) {
      throw this.emailTaken();
    }
  }

  private emailTaken(): AppError {
    return new AppError(409, ErrorCode.EmailTaken, "This email is already registered.");
  }

  /** Inside the transaction: the company and its first user are saved together or not at all. */
  private async saveAccount(company: Company, user: User, db: SQL): Promise<User> {
    await this.saveCompany(company, db);
    const saved = await this.saveUser(user, db);
    if (!company.approvedAt) {
      await this.notifications.notifyAdmins(
        `${company.name} signed up as a supplier and waits for approval.`,
        "/admin/suppliers",
        db,
      );
    }
    return saved;
  }

  /** The UNIQUE index on the name key is the guard: no case, no spaces at the ends. */
  private async saveCompany(company: Company, db?: SQL): Promise<void> {
    try {
      await this.companies.create(company, db);
    } catch (error) {
      throw isUniqueViolation(error) ? companyNameTaken() : error;
    }
  }

  /** The UNIQUE index on the email is the real guard. Its error becomes a 409. */
  private async saveUser(user: User, db?: SQL): Promise<User> {
    try {
      await this.users.create(user, db);
    } catch (error) {
      throw isUniqueViolation(error) ? this.emailTaken() : error;
    }
    return user;
  }

  private async buildUser(input: AdminInput, company: Company, isOwner: boolean): Promise<User> {
    return new User(
      crypto.randomUUID(),
      company.id,
      company.name,
      company.type,
      input.name,
      input.email,
      await Bun.password.hash(input.password),
      this.clock.timestamp(),
      null,
      isOwner,
      company.approvedAt,
    );
  }

  /** `impersonatorId` is the admin who acts as the user. Such a token lasts 2 hours. */
  private async issueToken(
    user: User,
    impersonatorId: string | null = null,
    db?: SQL,
  ): Promise<AuthResult> {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const now = new Date();
    const ttl = impersonatorId ? ACTING_TOKEN_TTL_MS : this.config.tokenTtlDays * DAY_MS;
    const expiresAt = new Date(now.getTime() + ttl).toISOString();
    await this.tokens.create(
      new AccessToken(
        crypto.randomUUID(),
        user.id,
        this.hashToken(token),
        expiresAt,
        now.toISOString(),
        impersonatorId,
      ),
      db,
    );
    return { user, token, expiresAt };
  }

  private hashToken(token: string): string {
    return new Bun.CryptoHasher("sha256").update(token).digest("hex");
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= Bun.password.hash(randomBytes(TOKEN_BYTES).toString("hex"));
    return this.dummyHash;
  }

  private unauthorized(): AppError {
    return new AppError(401, ErrorCode.Unauthorized, "The token is missing, wrong or expired.");
  }
}
