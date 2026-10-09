/** The price of an item is for one unit. */
export const ITEM_UNITS = ["piece", "set", "meter", "sqm"] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export const MAX_ITEM_PHOTOS = 8;
/** One company can have this many items. It stops one account from filling the database. */
export const MAX_COMPANY_ITEMS = 5000;
