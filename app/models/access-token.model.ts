export interface AccessTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  impersonator_id: string | null;
}

export class AccessToken {
  constructor(
    readonly id: string,
    readonly userId: string,
    readonly tokenHash: string,
    readonly expiresAt: string,
    readonly createdAt: string,
    /**
     * The platform admin who acts as `userId` with this token. `null` for a normal login.
     * Only the server sets it, when an admin starts to act as a customer.
     */
    readonly impersonatorId: string | null = null,
  ) {}

  static fromRow(row: AccessTokenRow): AccessToken {
    return new AccessToken(
      row.id,
      row.user_id,
      row.token_hash,
      row.expires_at,
      row.created_at,
      row.impersonator_id,
    );
  }

  isExpired(now: Date): boolean {
    return new Date(this.expiresAt) <= now;
  }
}
