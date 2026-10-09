export interface AccessTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export class AccessToken {
  constructor(
    readonly id: string,
    readonly userId: string,
    readonly tokenHash: string,
    readonly expiresAt: string,
    readonly createdAt: string,
  ) {}

  static fromRow(row: AccessTokenRow): AccessToken {
    return new AccessToken(row.id, row.user_id, row.token_hash, row.expires_at, row.created_at);
  }

  isExpired(now: Date): boolean {
    return new Date(this.expiresAt) <= now;
  }
}
