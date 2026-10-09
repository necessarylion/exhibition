/** A user has the role of their company. It is stored as `companies.type`. */
export const Role = {
  Admin: "admin",
  Supplier: "supplier",
  Customer: "customer",
} as const;

export type Role = (typeof Role)[keyof typeof Role];
