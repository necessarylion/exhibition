import type { Role } from "../constants/role.constants";

// Characters that nobody can see: zero-width ones, the marks that turn the text direction,
// the soft hyphen and the byte order mark. With one of them two names look the same but are not.
const INVISIBLE = /[\u0080-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export interface CompanyRow {
  id: string;
  name: string;
  type: Role;
  disabled_at: string | null;
  created_at: string;
  phone: string;
  address: string;
  website: string;
  about: string;
  approved_at: string | null;
  organization_id: string | null;
  /** The name of its group. Only the queries that join the group have it. */
  organization_name?: string | null;
  /** How many items it shows (not hidden). Only the queries that count them have it. */
  listed_item_count?: number;
  /** The email of the first user. Only the queries that select it have it. */
  contact_email?: string | null;
  /** Its orders (as supplier or as customer) that wait, and that are accepted. */
  pending_order_count?: number;
  accepted_order_count?: number;
}

export class Company {
  /** The profile. The owner of the company fills it. Empty text means not set. */
  phone = "";
  address = "";
  website = "";
  about = "";
  /** Empty while a supplier that signed up by itself waits for an admin. */
  approvedAt: string | null = null;
  /** The organization group. Only a customer company can be in one. */
  organizationId: string | null = null;
  organizationName: string | null = null;
  /** The items that are not hidden. A group shares exactly these. */
  listedItemCount = 0;
  /** Its orders, as supplier or as customer, that wait for an answer. */
  pendingOrderCount = 0;
  /** Its orders that are accepted and not completed yet. */
  acceptedOrderCount = 0;

  constructor(
    readonly id: string,
    public name: string,
    readonly type: Role,
    readonly createdAt: string,
    public disabledAt: string | null = null,
    readonly contactEmail: string | null = null,
  ) {}

  static fromRow(row: CompanyRow): Company {
    const company = new Company(
      row.id,
      row.name,
      row.type,
      row.created_at,
      row.disabled_at,
      row.contact_email ?? null,
    );
    company.phone = row.phone;
    company.address = row.address;
    company.website = row.website;
    company.about = row.about;
    company.approvedAt = row.approved_at;
    company.organizationId = row.organization_id;
    company.organizationName = row.organization_name ?? null;
    // PostgreSQL returns a COUNT as a string.
    company.listedItemCount = Number(row.listed_item_count ?? 0);
    company.pendingOrderCount = Number(row.pending_order_count ?? 0);
    company.acceptedOrderCount = Number(row.accepted_order_count ?? 0);
    return company;
  }

  /**
   * The one form of a name: Unicode NFKC (so a wide or a joined letter is the plain one),
   * no invisible character, one space between words and none at the ends.
   */
  static cleanName(name: string): string {
    return name.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  }

  /** Two names with the same key count as the same name: the clean form, without case. */
  // ponytail: a key from before this rule was made with LOWER(TRIM(name)) only. A new name is
  // still compared with it. Write the keys again in a script if old names ever clash.
  static nameKey(name: string): string {
    return Company.cleanName(name).toLowerCase();
  }

  /** One row of the admin lists. */
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      contactEmail: this.contactEmail,
      disabledAt: this.disabledAt,
      approvedAt: this.approvedAt,
      organizationId: this.organizationId,
      organizationName: this.organizationName,
      pendingOrderCount: this.pendingOrderCount,
      acceptedOrderCount: this.acceptedOrderCount,
      createdAt: this.createdAt,
    };
  }

  /** What the users of the company see of their own company. */
  toProfile() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      phone: this.phone,
      address: this.address,
      website: this.website,
      about: this.about,
      approvedAt: this.approvedAt,
      createdAt: this.createdAt,
    };
  }
}
