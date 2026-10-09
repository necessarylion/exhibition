import { Company } from "./company.model";

export interface OrganizationRow {
  id: string;
  name: string;
  name_key: string;
  created_at: string;
}

/** An organization group, like "True Group". Its customer companies share their items for free. */
export class Organization {
  /** The companies in the group, sorted by name. The service fills it. */
  companies: Company[] = [];

  constructor(
    readonly id: string,
    public name: string,
    readonly createdAt: string,
  ) {}

  static fromRow(row: OrganizationRow): Organization {
    return new Organization(row.id, row.name, row.created_at);
  }

  /** What an admin sees. */
  toPublic() {
    const companies = [];
    for (const company of this.companies) {
      companies.push({
        id: company.id,
        name: company.name,
        contactEmail: company.contactEmail,
        itemCount: company.listedItemCount,
      });
    }
    return { id: this.id, name: this.name, createdAt: this.createdAt, companies };
  }

  /** What a company of the group sees: only the names. */
  toMember() {
    const companies = [];
    for (const company of this.companies) {
      companies.push({ id: company.id, name: company.name });
    }
    return { id: this.id, name: this.name, companies };
  }
}

/** The same rule as for a company name: no case, no spaces at the ends. */
export const organizationNameKey = Company.nameKey;
