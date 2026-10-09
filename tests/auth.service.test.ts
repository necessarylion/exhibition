import { beforeEach, describe, expect, test } from "bun:test";
import { AppConfig } from "../app/config/app.config";
import { AppError } from "../app/errors/app.error";
import type { AccessToken } from "../app/models/access-token.model";
import type { User } from "../app/models/user.model";
import type { AccessTokenRepository } from "../app/repositories/access-token.repository";
import type { UserRepository } from "../app/repositories/user.repository";
import { AuthService } from "../app/services/auth.service";

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

const input = { name: "Aung", email: "aung@example.com", password: "a-long-password" };

function buildService(tokenTtlDays: string) {
  const users = new FakeUserRepository();
  const tokens = new FakeAccessTokenRepository();
  const service = new AuthService(
    users as unknown as UserRepository,
    tokens as unknown as AccessTokenRepository,
    new AppConfig({ TOKEN_TTL_DAYS: tokenTtlDays }),
  );
  return { users, tokens, service };
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
    await context.service.logout(result.token);

    expect(context.service.authenticate(result.token)).rejects.toBeInstanceOf(AppError);
  });

  test("an expired token is rejected and removed", async () => {
    context = buildService("-1");
    const result = await context.service.register(input);

    expect(context.service.authenticate(result.token)).rejects.toMatchObject({ status: 401 });
    expect(context.tokens.tokens).toHaveLength(0);
  });
});
