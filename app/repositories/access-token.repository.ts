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

  async create(token: AccessToken): Promise<void> {
    await this.sql`
      INSERT INTO access_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (${token.id}, ${token.userId}, ${token.tokenHash}, ${token.expiresAt}, ${token.createdAt})
    `;
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM access_tokens WHERE token_hash = ${tokenHash}`;
  }
}
