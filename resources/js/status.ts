import type { OrderStatus, ProjectStatus } from "./api";

export type Status = ProjectStatus | OrderStatus;

/** The words the user sees. An order that is `pending` is "Waiting", like a project. */
export const STATUS_LABELS: Record<Status, string> = {
  draft: "Draft",
  waiting: "Waiting",
  pending: "Waiting",
  confirmed: "Confirmed",
  accepted: "Accepted",
  completed: "Completed",
  done: "Done",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** The colour class of the badge. One map for projects and orders. */
export const STATUS_CLASSES: Record<Status, string> = {
  draft: "",
  waiting: "warn",
  pending: "warn",
  confirmed: "ok",
  accepted: "ok",
  completed: "dark",
  done: "dark",
  rejected: "bad",
  cancelled: "bad",
};

export const PROJECT_STATUSES: ProjectStatus[] = [
  "draft",
  "waiting",
  "confirmed",
  "done",
  "cancelled",
];
export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "completed",
  "rejected",
  "cancelled",
];
