import { SQL, type TransactionSQL } from "bun";
import { singleton } from "tsyringe";
import { OrderStatus } from "../constants/order.constants";
import type { Role } from "../constants/role.constants";
import { Company, type CompanyRow } from "../models/company.model";
import type { Page, PageQuery } from "../schemas/page.schema";
import { searchSql } from "./search";
import { TransactionRunner } from "./transaction-runner";

/** The columns the owner (or an admin, for the name) can change. They have the same name in the API. */
export interface CompanyProfileFields {
  name?: string;
  phone?: string;
  address?: string;
  website?: string;
  about?: string;
}

@singleton()
export class CompanyRepository {
  constructor(
    private readonly sql: SQL,
    private readonly transactions: TransactionRunner,
  ) {}

  /** Runs the work in one transaction. A failure leaves nothing half-done. */
  transaction<T>(work: (db: TransactionSQL) => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }

  /**
   * One page of the companies of a type, and the number of them. A supplier that waits
   * for approval comes first, then the names in order.
   * `ungrouped` gives only the companies that are in no organization group.
   * `page.q` searches the name, the email of the first user and the name of the group.
   * `counts` says how many of them wait for approval and how many are disabled.
   */
  async listByType(type: Role, page: PageQuery, ungrouped = false): Promise<Page<Company>> {
    const db = this.sql;
    const search = searchSql(db, page.q, [
      db`companies.name`,
      db`organizations.name`,
      this.contactEmail(db),
    ]);
    const group = ungrouped ? db`AND companies.organization_id IS NULL` : db``;
    const where = db`WHERE companies.type = ${type} ${group} ${search}`;
    const rows = await this.select(
      db,
      db`${where}
        ORDER BY CASE WHEN companies.approved_at IS NULL THEN 0 ELSE 1 END,
          companies.name, companies.id
        LIMIT ${page.limit} OFFSET ${page.offset}`,
    );
    const [count] = await db`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN companies.approved_at IS NULL THEN 1 ELSE 0 END), 0) AS waiting,
        COALESCE(SUM(CASE WHEN companies.disabled_at IS NULL THEN 0 ELSE 1 END), 0) AS disabled
      FROM companies LEFT JOIN organizations ON organizations.id = companies.organization_id
      ${where}
    `;
    // PostgreSQL returns a COUNT and a SUM as strings.
    return {
      rows,
      total: Number(count.total),
      counts: { waiting: Number(count.waiting), disabled: Number(count.disabled) },
    };
  }

  /** The email of the first user of the company. */
  private contactEmail(db: SQL): SQL.Query<unknown> {
    return db`(SELECT email FROM users WHERE users.company_id = companies.id
      ORDER BY users.created_at, users.id LIMIT 1)`;
  }

  /** Pass `db` to read inside a transaction. */
  async findById(id: string, db: SQL = this.sql): Promise<Company | null> {
    return (await this.select(db, db`WHERE companies.id = ${id}`))[0] ?? null;
  }

  /** The companies of one organization group, sorted by name. */
  listByOrganization(organizationId: string): Promise<Company[]> {
    return this.select(
      this.sql,
      this.sql`WHERE companies.organization_id = ${organizationId}
        ORDER BY companies.name, companies.id`,
    );
  }

  async findFirstByType(type: Role): Promise<Company | null> {
    const rows: CompanyRow[] = await this.sql`SELECT * FROM companies WHERE type = ${type} LIMIT 1`;
    return rows[0] ? Company.fromRow(rows[0]) : null;
  }

  /**
   * Pass `db` to run inside a transaction.
   * The UNIQUE index on `name_key` refuses a name that another company has.
   */
  async create(company: Company, db: SQL = this.sql): Promise<void> {
    await db`
      INSERT INTO companies (id, name, name_key, type, created_at, approved_at)
      VALUES (${company.id}, ${company.name}, ${Company.nameKey(company.name)}, ${company.type},
        ${company.createdAt}, ${company.approvedAt})
    `;
  }

  /**
   * Saves only the given fields. `disabled_at` and `approved_at` are never part of it, so
   * a profile save that runs at the same moment as "disable" or "approve" cannot undo it.
   * A new name also writes its `name_key`. The UNIQUE index refuses a name that is taken.
   */
  async updateProfile(id: string, fields: CompanyProfileFields): Promise<void> {
    const row: Record<string, string> = {};
    for (const [column, value] of Object.entries(fields)) {
      if (value !== undefined) {
        row[column] = value;
      }
    }
    if (Object.keys(row).length === 0) {
      return;
    }
    if (row.name !== undefined) {
      row.name_key = Company.nameKey(row.name);
    }
    await this.sql`UPDATE companies SET ${this.sql(row)} WHERE id = ${id}`;
  }

  /** Disables the company. A company that is already disabled keeps its first date. */
  /**
   * Locks the rows of these companies until the transaction ends. False when one of them
   * is disabled (or gone). "Send request" calls it, so a company cannot be disabled in the
   * middle of a send: the send waits for the disable, or the disable waits for the send.
   * The ids are locked in a fixed order, so two transactions never wait for each other.
   */
  async lockEnabled(ids: readonly string[], db: SQL): Promise<boolean> {
    let enabled = true;
    for (const id of [...new Set(ids)].sort()) {
      // An UPDATE that changes nothing. It takes the row lock on both databases.
      const result = await db`
        UPDATE companies SET id = id WHERE id = ${id} AND disabled_at IS NULL
      `;
      enabled &&= result.count > 0;
    }
    return enabled;
  }

  /**
   * This UPDATE takes the lock of the company row. It waits for a "Send request" that
   * holds the row (see `lockEnabled`), so the order of that send is there when the
   * waiting orders are cancelled next.
   */
  async disable(id: string, at: string): Promise<void> {
    await this
      .sql`UPDATE companies SET disabled_at = COALESCE(disabled_at, ${at}) WHERE id = ${id}`;
  }

  async enable(id: string): Promise<void> {
    await this.sql`UPDATE companies SET disabled_at = NULL WHERE id = ${id}`;
  }

  /**
   * Approves the company. True when this call did it. False when it was approved already:
   * the `approved_at IS NULL` part lets only one of two calls at the same moment win.
   */
  async approve(id: string, at: string, db: SQL = this.sql): Promise<boolean> {
    const result = await db`
      UPDATE companies SET approved_at = ${at} WHERE id = ${id} AND approved_at IS NULL
    `;
    return result.count > 0;
  }

  /**
   * Puts the company in the group. It does nothing when the company is already in
   * another group, so two admins at the same moment cannot both win. Read it again after.
   */
  async joinOrganization(id: string, organizationId: string): Promise<void> {
    await this.sql`
      UPDATE companies SET organization_id = ${organizationId}
      WHERE id = ${id} AND (organization_id IS NULL OR organization_id = ${organizationId})
    `;
  }

  async leaveOrganization(id: string): Promise<void> {
    await this.sql`UPDATE companies SET organization_id = NULL WHERE id = ${id}`;
  }

  /** The companies with the email of their first user, the name of their group and their item count. */
  private async select(db: SQL, tail: SQL.Query<unknown>): Promise<Company[]> {
    const rows: CompanyRow[] = await db`
      SELECT companies.*, organizations.name AS organization_name,
        ${this.contactEmail(db)} AS contact_email, (
        SELECT COUNT(*) FROM items
        WHERE items.company_id = companies.id AND items.hidden_at IS NULL
      ) AS listed_item_count, (
        SELECT COUNT(*) FROM orders WHERE orders.status = ${OrderStatus.Pending}
          AND (orders.supplier_company_id = companies.id
            OR orders.customer_company_id = companies.id)
      ) AS pending_order_count, (
        SELECT COUNT(*) FROM orders WHERE orders.status = ${OrderStatus.Accepted}
          AND (orders.supplier_company_id = companies.id
            OR orders.customer_company_id = companies.id)
      ) AS accepted_order_count
      FROM companies LEFT JOIN organizations ON organizations.id = companies.organization_id
      ${tail}
    `;
    const companies: Company[] = [];
    for (const row of rows) {
      companies.push(Company.fromRow(row));
    }
    return companies;
  }
}
