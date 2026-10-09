import type { ItemUnit } from "./api";

// ponytail: one currency (USD) for the whole app. Add a currency setting when a second one is needed.
const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Prices are stored in whole cents. */
export function formatPrice(cents: number): string {
  return formatter.format(cents / 100);
}

export const UNIT_LABELS: Record<ItemUnit, string> = {
  piece: "piece",
  set: "set",
  meter: "meter",
  sqm: "square meter",
};
