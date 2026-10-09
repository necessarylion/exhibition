/** What the availability check needs to know of an item. */
interface Stocked {
  stock: number | null;
  available: number | null;
}

/**
 * How many of an item a customer can still take, in words.
 * With a project the number is for the dates of that project. A free item (my own, or
 * shared by my organization group) is not checked by date, so it shows its stock.
 */
export function availabilityText(item: Stocked, forProject: boolean, free: boolean): string {
  if (!forProject || free) {
    if (item.stock === null) {
      return "In stock";
    }
    return item.stock === 0 ? "Out of stock" : `${item.stock} in stock`;
  }
  if (item.available === null) {
    return "Available for your dates";
  }
  return item.available === 0
    ? "Not available for your dates"
    : `${item.available} available for your dates`;
}

/** True when the customer can add at least one. A free item can always be added. */
export function canAdd(item: Stocked, free: boolean): boolean {
  return free || item.available !== 0;
}

/** Who owns a catalog item, as the customer who looks at it sees it. */
export type Ownership = "own" | "shared" | "supplier";

/**
 * A customer gets the item of another customer only through its organization group.
 * So an item of a customer company that is not mine is a shared one. Both are free.
 */
export function ownershipOf(
  item: { companyId: string; companyType: string },
  myCompanyId: string | undefined,
): Ownership {
  if (item.companyId === myCompanyId) {
    return "own";
  }
  return item.companyType === "customer" ? "shared" : "supplier";
}
