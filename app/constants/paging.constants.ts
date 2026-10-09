export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 200;
/** The response header with the number of rows before `limit` and `offset`. */
export const TOTAL_COUNT_HEADER = "X-Total-Count";
/**
 * The response header with more numbers of the whole list, as JSON: the rows per status
 * (for the same search, without the status filter) and sums of money in cents.
 */
export const COUNTS_HEADER = "X-Counts";
