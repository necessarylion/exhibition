import { SQL } from "bun";
import { singleton } from "tsyringe";
import { User, type UserRow } from "../models/user.model";
import type { Page, PageQuery } from "../schemas/page.schema";
import { searchSql } from "./search";

@singleton()
export class UserRepository {
  constructor(private readonly sql: SQL) {}

  async findById(id: string): Promise<User | null> {
    const rows: UserRow[] = await this.sql`
      SELECT users.*, companies.name AS company_name, companies.type AS role,
        companies.disabled_at AS company_disabled_at,
        companies.approved_at AS company_approved_at
      FROM users JOIN companies ON companies.id = users.company_id
      WHERE users.id = ${id}
    `;
    return rows[0] ? User.fromRow(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows: UserRow[] = await this.sql`
      SELECT users.*, companies.name AS company_name, companies.type AS role,
        companies.disabled_at AS company_disabled_at,
        companies.approved_at AS company_approved_at
      FROM users JOIN companies ON companies.id = users.company_id
      WHERE users.email = ${email}
    `;
    return rows[0] ? User.fromRow(rows[0]) : null;
  }

  /** The owner of the company: its first user. */
  async findOwner(companyId: string): Promise<User | null> {
    const rows: UserRow[] = await this.sql`
      SELECT users.*, companies.name AS company_name, companies.type AS role,
        companies.disabled_at AS company_disabled_at,
        companies.approved_at AS company_approved_at
      FROM users JOIN companies ON companies.id = users.company_id
      WHERE users.company_id = ${companyId} AND users.is_owner = 1
    `;
    return rows[0] ? User.fromRow(rows[0]) : null;
  }

  /** The users of one company, the oldest first. `page.q` searches the name and the email. */
  async listByCompany(companyId: string, page: PageQuery): Promise<Page<User>> {
    const db = this.sql;
    const where = db`
      WHERE users.company_id = ${companyId}
      ${searchSql(db, page.q, [db`users.name`, db`users.email`])}
    `;
    const rows: UserRow[] = await db`
      SELECT users.*, companies.name AS company_name, companies.type AS role,
        companies.disabled_at AS company_disabled_at,
        companies.approved_at AS company_approved_at
      FROM users JOIN companies ON companies.id = users.company_id
      ${where}
      ORDER BY users.created_at, users.id
      LIMIT ${page.limit} OFFSET ${page.offset}
    `;
    const [count] = await db`SELECT COUNT(*) AS total FROM users ${where}`;
    const users: User[] = [];
    for (const row of rows) {
      users.push(User.fromRow(row));
    }
    // PostgreSQL returns a COUNT as a string.
    return { rows: users, total: Number(count.total) };
  }

  async delete(id: string): Promise<void> {
    await this.sql`DELETE FROM users WHERE id = ${id}`;
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.sql`UPDATE users SET name = ${name} WHERE id = ${id}`;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
  }

  /** Pass `db` to run inside a transaction. */
  async create(user: User, db: SQL = this.sql): Promise<void> {
    await db`
      INSERT INTO users (id, company_id, name, email, password_hash, is_owner, created_at)
      VALUES (
        ${user.id}, ${user.companyId}, ${user.name}, ${user.email},
        ${user.passwordHash}, ${user.isOwner ? 1 : 0}, ${user.createdAt}
      )
    `;
  }
}
