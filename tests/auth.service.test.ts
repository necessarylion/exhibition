import { beforeEach, describe, expect, test } from "bun:test";
import { AppConfig } from "../app/config/app.config";
import { AppError } from "../app/errors/app.error";
import { AccessToken } from "../app/models/access-token.model";
import type { Company } from "../app/models/company.model";
import type { User } from "../app/models/user.model";
import type { AccessTokenRepository } from "../app/repositories/access-token.repository";
import type { AdminActionRepository } from "../app/repositories/admin-action.repository";
import type { CompanyRepository } from "../app/repositories/company.repository";
import type { UserRepository } from "../app/repositories/user.repository";
import { AuthService } from "../app/services/auth.service";
import { Clock } from "../app/services/clock.service";
import type { NotificationService } from "../app/services/notification.service";

// Mocks go straight into the constructor. The container is not used in tests.
class FakeUserRepository {
  readonly users: User[] = [];

  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async create(user: User) {
    this.users.push(user);
  }
}

class FakeCompanyRepository {
  readonly companies: Company[] = [];

  async findFirstByType(type: string) {
    return this.companies.find((company) => company.type === type) ?? null;
  }

  async create(company: Company) {
    this.companies.push(company);
  }

  /** There is no real transaction here. The work just runs. */
  transaction<T>(work: (db: undefined) => Promise<T>) {
    return work(undefined);
  }
}

class FakeAccessTokenRepository {
  tokens: AccessToken[] = [];

  async findByHash(tokenHash: string) {
    return this.tokens.find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async create(token: AccessToken) {
    this.tokens.push(token);
  }

  async deleteByHash(tokenHash: string) {
    this.tokens = this.tokens.filter((token) => token.tokenHash !== tokenHash);
  }
}

const input = {
  name: "Aung",
  email: "aung@example.com",
  password: "a-long-password",
  role: "customer" as const,
  companyName: "Aung Trading",
};

function buildService(tokenTtlDays: string) {
  const users = new FakeUserRepository();
  const companies = new FakeCompanyRepository();
  const tokens = new FakeAccessTokenRepository();
  const service = new AuthService(
    users as unknown as UserRepository,
    companies as unknown as CompanyRepository,
    tokens as unknown as AccessTokenRepository,
    new AppConfig({ TOKEN_TTL_DAYS: tokenTtlDays }),
    new Clock(),
    // A customer sign-up tells nobody, so this is never called.
    {} as NotificationService,
    {} as AdminActionRepository,
  );
  return { users, companies, tokens, service };
}

describe("AuthService", () => {
  let context: ReturnType<typeof buildService>;

  beforeEach(() => {
    context = buildService("30");
  });

  test("register stores a password hash and a token hash, never the plain values", async () => {
    const result = await context.service.register(input);

    expect(context.users.users[0]?.passwordHash).not.toBe(input.password);
    expect(context.users.users[0]?.passwordHash).toStartWith("$argon2id$");
    expect(context.tokens.tokens[0]?.tokenHash).not.toBe(result.token);
  });

  test("register rejects an email that is already used", async () => {
    await context.service.register(input);

    expect(context.service.register(input)).rejects.toMatchObject({ status: 409 });
  });

  test("register creates a company and gives its role to the user", async () => {
    const result = await context.service.register(input);

    expect(context.companies.companies[0]?.type).toBe("customer");
    expect(result.user.role).toBe("customer");
    expect(result.user.companyId).toBe(context.companies.companies[0]?.id as string);
  });

  test("every admin joins the same admin company", async () => {
    const first = await context.service.registerAdmin({ ...input, email: "a@example.com" });
    const second = await context.service.registerAdmin({ ...input, email: "b@example.com" });

    expect(first.role).toBe("admin");
    expect(first.isOwner).toBe(true);
    expect(second.isOwner).toBe(false);
    expect(second.companyId).toBe(first.companyId);
    expect(context.companies.companies).toHaveLength(1);
  });

  test("login returns a token that authenticate accepts", async () => {
    await context.service.register(input);
    const result = await context.service.login({ email: input.email, password: input.password });

    const user = await context.service.authenticate(result.token);
    expect(user.email).toBe(input.email);
  });

  test("login rejects a wrong password and an unknown email the same way", async () => {
    await context.service.register(input);

    const wrongPassword = context.service.login({ email: input.email, password: "wrong" });
    const unknownEmail = context.service.login({ email: "no@example.com", password: "wrong" });
    expect(wrongPassword).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
    expect(unknownEmail).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
  });

  test("logout makes the token stop working", async () => {
    const result = await context.service.register(input);
    await context.service.logout(result.user, result.token);

    expect(context.service.authenticate(result.token)).rejects.toBeInstanceOf(AppError);
  });

  test("an expired token is rejected and removed", async () => {
    const result = await context.service.register(input);
    const token = context.tokens.tokens[0] as AccessToken;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    context.tokens.tokens = [
      new AccessToken(token.id, token.userId, token.tokenHash, yesterday, token.createdAt),
    ];

    expect(context.service.authenticate(result.token)).rejects.toMatchObject({ status: 401 });
    expect(context.tokens.tokens).toHaveLength(0);
  });
});
