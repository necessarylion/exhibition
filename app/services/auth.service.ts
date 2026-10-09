import { randomBytes } from "node:crypto";
import { singleton } from "tsyringe";
import { AppConfig } from "../config/app.config";
import { ErrorCode, TOKEN_BYTES } from "../constants/api.constants";
import { AppError } from "../errors/app.error";
import { AccessToken } from "../models/access-token.model";
import { User } from "../models/user.model";
import { AccessTokenRepository } from "../repositories/access-token.repository";
import { UserRepository } from "../repositories/user.repository";
import type { LoginInput, RegisterInput } from "../schemas/auth.schema";

export interface AuthResult {
  user: User;
  /** The plain token. It is shown once. Only its hash is stored. */
  token: string;
  expiresAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@singleton()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AccessTokenRepository,
    private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    // ponytail: check then insert. Two requests at the same moment can both pass the check;
    // the UNIQUE index stops the second one with a 500. Map that DB error to 409 if it matters.
    if (await this.users.findByEmail(input.email)) {
      throw new AppError(409, ErrorCode.EmailTaken, "This email is already registered.");
    }
    const user = new User(
      crypto.randomUUID(),
      input.name,
      input.email,
      await Bun.password.hash(input.password),
      new Date().toISOString(),
    );
    await this.users.create(user);
    return this.issueToken(user);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    // Always verify a hash, so an unknown email takes the same time as a wrong password.
    const hash = user ? user.passwordHash : await this.getDummyHash();
    const passwordMatches = await Bun.password.verify(input.password, hash);
    if (!user || !passwordMatches) {
      throw new AppError(401, ErrorCode.InvalidCredentials, "Email or password is wrong.");
    }
    return this.issueToken(user);
  }

  async logout(token: string): Promise<void> {
    await this.tokens.deleteByHash(this.hashToken(token));
  }

  /** Returns the user that owns the token. Throws 401 when the token is not valid. */
  async authenticate(token: string): Promise<User> {
    const tokenHash = this.hashToken(token);
    const record = await this.tokens.findByHash(tokenHash);
    if (!record) {
      throw this.unauthorized();
    }
    if (record.isExpired(new Date())) {
      // ponytail: expired tokens are removed only when someone uses them.
      // Add a scheduled DELETE if the table grows.
      await this.tokens.deleteByHash(tokenHash);
      throw this.unauthorized();
    }
    const user = await this.users.findById(record.userId);
    if (!user) {
      throw this.unauthorized();
    }
    return user;
  }

  private async issueToken(user: User): Promise<AuthResult> {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.tokenTtlDays * DAY_MS).toISOString();
    await this.tokens.create(
      new AccessToken(
        crypto.randomUUID(),
        user.id,
        this.hashToken(token),
        expiresAt,
        now.toISOString(),
      ),
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
