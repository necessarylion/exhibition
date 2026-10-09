import { SQL } from "bun";
import { singleton } from "tsyringe";
import {
  Organization,
  type OrganizationRow,
  organizationNameKey,
} from "../models/organization.model";
import { searchSql } from "./search";

@singleton()
export class OrganizationRepository {
  constructor(private readonly sql: SQL) {}

  /** Every group, sorted by name. */
  // ponytail: no paging. A platform has a handful of groups. Page it when there are hundreds.
  async list(q?: string): Promise<Organization[]> {
    const db = this.sql;
    const member = db`(SELECT MIN(companies.name) FROM companies
      WHERE companies.organization_id = organizations.id
        ${searchSql(db, q, [db`companies.name`])})`;
    const rows: OrganizationRow[] = await db`
      SELECT * FROM organizations
      WHERE 1 = 1 ${searchSql(db, q, [db`organizations.name`, member])}
      ORDER BY name, id
    `;
    const organizations: Organization[] = [];
    for (const row of rows) {
      organizations.push(Organization.fromRow(row));
    }
    return organizations;
  }

  async findById(id: string): Promise<Organization | null> {
    const rows: OrganizationRow[] = await this.sql`SELECT * FROM organizations WHERE id = ${id}`;
    return rows[0] ? Organization.fromRow(rows[0]) : null;
  }

  /** The UNIQUE index on `name_key` refuses a name that another group has. */
  async create(organization: Organization): Promise<void> {
    await this.sql`
      INSERT INTO organizations (id, name, name_key, created_at)
      VALUES (${organization.id}, ${organization.name},
        ${organizationNameKey(organization.name)}, ${organization.createdAt})
    `;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.sql`
      UPDATE organizations SET name = ${name}, name_key = ${organizationNameKey(name)}
      WHERE id = ${id}
    `;
  }

  /** The companies of the group stay. The database sets their `organization_id` to NULL. */
  async delete(id: string): Promise<void> {
    await this.sql`DELETE FROM organizations WHERE id = ${id}`;
  }
}
