import { SQL } from "bun";
import { singleton } from "tsyringe";
import { AccessToken, type AccessTokenRow } from "../models/access-token.model";

@singleton()
export class AccessTokenRepository {
  constructor(private readonly sql: SQL) {}

  async findByHash(tokenHash: string): Promise<AccessToken | null> {
    const rows: AccessTokenRow[] = await this.sql`
      SELECT * FROM access_tokens WHERE token_hash = ${tokenHash}
    `;
    return rows[0] ? AccessToken.fromRow(rows[0]) : null;
  }

  /** Pass `db` to write inside a transaction. */
  async create(token: AccessToken, db: SQL = this.sql): Promise<void> {
    await db`
      INSERT INTO access_tokens (id, user_id, token_hash, expires_at, created_at, impersonator_id)
      VALUES (${token.id}, ${token.userId}, ${token.tokenHash}, ${token.expiresAt},
        ${token.createdAt}, ${token.impersonatorId})
    `;
  }

  /**
   * Every token of the user: the logins of the user, the tokens an admin holds to act as
   * this user, and the tokens this user (an admin) holds to act as a customer.
   */
  async deleteByUser(userId: string): Promise<void> {
    await this.sql`
      DELETE FROM access_tokens WHERE user_id = ${userId} OR impersonator_id = ${userId}
    `;
  }

  /** Logs the user out everywhere else. The token with this hash stays. */
  async deleteOthersOfUser(userId: string, keepTokenHash: string): Promise<void> {
    await this.sql`
      DELETE FROM access_tokens
      WHERE (user_id = ${userId} OR impersonator_id = ${userId}) AND token_hash <> ${keepTokenHash}
    `;
  }

  /** The tokens with which this admin acts as a customer. */
  async deleteByImpersonator(adminUserId: string): Promise<void> {
    await this.sql`DELETE FROM access_tokens WHERE impersonator_id = ${adminUserId}`;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM access_tokens WHERE token_hash = ${tokenHash}`;
  }

  /** `now` is an ISO string. ISO strings in UTC compare like dates. */
  async deleteExpired(now: string): Promise<void> {
    await this.sql`DELETE FROM access_tokens WHERE expires_at <= ${now}`;
  }
}
