/** The status of a project is not stored. `ProjectRepository.statusSql` works it out. */
export const ProjectStatus = {
  Draft: "draft",
  Waiting: "waiting",
  Confirmed: "confirmed",
  Done: "done",
  Cancelled: "cancelled",
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const PROJECT_STATUSES = ["draft", "waiting", "confirmed", "done", "cancelled"] as const;

/** A project in one of these statuses is still going on. */
export const OPEN_PROJECT_STATUSES = [
  ProjectStatus.Draft,
  ProjectStatus.Waiting,
  ProjectStatus.Confirmed,
] as const;

/** The order of a project list. */
export const ProjectSort = {
  /** The latest event first. */
  Event: "event",
  /** The event that starts first is first. */
  Soonest: "soonest",
  /** The project that was made last is first. */
  Newest: "newest",
  /** The events to come, the next one first. Then the events that are over. */
  Next: "next",
} as const;

export type ProjectSort = (typeof ProjectSort)[keyof typeof ProjectSort];

/**
 * own: an item of the customer itself. It is free and is never in an order.
 * shared: an item of another company of the same organization group. Free like an own item:
 *   no price, no order, no approval. It stays `shared` after the company leaves the group.
 * not_sent: an item of another company that is not in an order yet.
 * sent: the line is in an order. It cannot change any more.
 */
export const LineState = {
  Own: "own",
  Shared: "shared",
  NotSent: "not_sent",
  Sent: "sent",
} as const;

export type LineState = (typeof LineState)[keyof typeof LineState];

export const LINE_STATES = ["own", "shared", "not_sent", "sent"] as const;

/** The lines in these states are free. They are never sent, never priced and not checked by date. */
export const FREE_LINE_STATES: readonly LineState[] = [LineState.Own, LineState.Shared];

export const MAX_LINE_QUANTITY = 10_000;

/** How many times an order is saved with a new number when its number is taken. */
export const MAX_ORDER_NUMBER_TRIES = 5;
