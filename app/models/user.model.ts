import type { Role } from "../constants/role.constants";

/** A `users` row joined with its company. */
export interface UserRow {
  id: string;
  company_id: string;
  company_name: string;
  company_disabled_at: string | null;
  company_approved_at: string | null;
  role: Role;
  name: string;
  email: string;
  password_hash: string;
  is_owner: number;
  created_at: string;
}

export class User {
  /**
   * Set when a platform admin acts as this user. The bearer check sets it from the token.
   * Nothing in a request can set it.
   */
  actingAdmin: { id: string; name: string } | null = null;

  constructor(
    readonly id: string,
    readonly companyId: string,
    readonly companyName: string,
    readonly role: Role,
    readonly name: string,
    readonly email: string,
    readonly passwordHash: string,
    readonly createdAt: string,
    readonly companyDisabledAt: string | null = null,
    /** The main user of the company. The owner cannot be removed. */
    readonly isOwner: boolean = false,
    /** Empty while the company (a supplier that signed up by itself) waits for an admin. */
    readonly companyApprovedAt: string | null = null,
  ) {}

  static fromRow(row: UserRow): User {
    return new User(
      row.id,
      row.company_id,
      row.company_name,
      row.role,
      row.name,
      row.email,
      row.password_hash,
      row.created_at,
      row.company_disabled_at,
      Number(row.is_owner) === 1,
      row.company_approved_at,
    );
  }

  /** The fields that are safe to send to a client. */
  toPublic() {
    return {
      id: this.id,
      companyId: this.companyId,
      companyName: this.companyName,
      role: this.role,
      isOwner: this.isOwner,
      companyApproved: this.companyApprovedAt !== null,
      name: this.name,
      email: this.email,
      actingAdmin: this.actingAdmin,
      createdAt: this.createdAt,
    };
  }
}
