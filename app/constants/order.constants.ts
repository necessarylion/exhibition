export const OrderStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Rejected: "rejected",
  Cancelled: "cancelled",
  Completed: "completed",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "completed",
] as const;

/** Orders in these statuses count for the project status and the project total. */
export const ACTIVE_ORDER_STATUSES = [
  OrderStatus.Pending,
  OrderStatus.Accepted,
  OrderStatus.Completed,
] as const;

export const ORDER_NUMBER_PREFIX = "ORD-";
/** The first order has this number. A number is the prefix and a count, like "ORD-1048". */
export const FIRST_ORDER_NUMBER = 1001;
