import { SQL } from "bun";
import { singleton } from "tsyringe";
import { User, type UserRow } from "../models/user.model";

@singleton()
export class UserRepository {
  constructor(private readonly sql: SQL) {}

  async findById(id: string): Promise<User | null> {
    const rows: UserRow[] = await this.sql`SELECT * FROM users WHERE id = ${id}`;
    return rows[0] ? User.fromRow(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows: UserRow[] = await this.sql`SELECT * FROM users WHERE email = ${email}`;
    return rows[0] ? User.fromRow(rows[0]) : null;
  }

  async create(user: User): Promise<void> {
    await this.sql`
      INSERT INTO users (id, name, email, password_hash, created_at)
      VALUES (${user.id}, ${user.name}, ${user.email}, ${user.passwordHash}, ${user.createdAt})
    `;
  }
}
