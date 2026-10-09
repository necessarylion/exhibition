export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export class User {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly email: string,
    readonly passwordHash: string,
    readonly createdAt: string,
  ) {}

  static fromRow(row: UserRow): User {
    return new User(row.id, row.name, row.email, row.password_hash, row.created_at);
  }

  /** The fields that are safe to send to a client. */
  toPublic() {
    return { id: this.id, name: this.name, email: this.email, createdAt: this.createdAt };
  }
}
