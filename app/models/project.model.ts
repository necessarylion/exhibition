import { ProjectStatus } from "../constants/project.constants";

/** A `projects` row joined with its company and the counts of its orders and lines. */
export interface ProjectRow {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  venue: string;
  city: string;
  hall: string;
  booth_number: string;
  booth_width_cm: number | null;
  booth_depth_cm: number | null;
  starts_on: string;
  ends_on: string;
  setup_on: string | null;
  notes: string;
  cancelled_at: string | null;
  done_at: string | null;
  created_by: string | null;
  created_by_admin_id: string | null;
  created_by_admin_name: string | null;
  created_at: string;
  /** Worked out by the query. See `ProjectRepository.statusSql`. */
  status: ProjectStatus;
  order_count: number;
  pending_order_count: number;
  active_order_count: number;
  accepted_order_count: number;
  line_count: number;
  total_cents: number;
}

export class Project {
  venue = "";
  city = "";
  hall = "";
  boothNumber = "";
  boothWidthCm: number | null = null;
  boothDepthCm: number | null = null;
  setupOn: string | null = null;
  notes = "";
  cancelledAt: string | null = null;
  doneAt: string | null = null;
  /** Not stored. The query works it out. A new project is a draft. */
  status: ProjectStatus = ProjectStatus.Draft;
  /** Every order, also the rejected and the cancelled ones. */
  orderCount = 0;
  pendingOrderCount = 0;
  /** Orders that are pending, accepted or completed. */
  activeOrderCount = 0;
  acceptedOrderCount = 0;
  lineCount = 0;
  /** The sum of the totals of the pending, accepted and completed orders. */
  totalCents = 0;
  /** Set when a platform admin made it while acting as the customer. */
  createdByAdminId: string | null = null;
  createdByAdminName: string | null = null;

  constructor(
    readonly id: string,
    readonly companyId: string,
    readonly companyName: string,
    public name: string,
    public startsOn: string,
    public endsOn: string,
    readonly createdBy: string | null,
    readonly createdAt: string,
  ) {}

  static fromRow(row: ProjectRow): Project {
    const project = new Project(
      row.id,
      row.company_id,
      row.company_name,
      row.name,
      row.starts_on,
      row.ends_on,
      row.created_by,
      row.created_at,
    );
    project.venue = row.venue;
    project.city = row.city;
    project.hall = row.hall;
    project.boothNumber = row.booth_number;
    // PostgreSQL can return an INTEGER, a COUNT or a SUM as a string.
    project.boothWidthCm = row.booth_width_cm === null ? null : Number(row.booth_width_cm);
    project.boothDepthCm = row.booth_depth_cm === null ? null : Number(row.booth_depth_cm);
    project.setupOn = row.setup_on;
    project.notes = row.notes;
    project.cancelledAt = row.cancelled_at;
    project.doneAt = row.done_at;
    project.status = row.status;
    project.orderCount = Number(row.order_count);
    project.pendingOrderCount = Number(row.pending_order_count);
    project.activeOrderCount = Number(row.active_order_count);
    project.acceptedOrderCount = Number(row.accepted_order_count);
    project.lineCount = Number(row.line_count);
    project.totalCents = Number(row.total_cents);
    project.createdByAdminId = row.created_by_admin_id;
    project.createdByAdminName = row.created_by_admin_name;
    return project;
  }

  /** The first day the items are needed: the setup day, or the first day of the event. */
  get reservedFrom(): string {
    return this.setupOn ?? this.startsOn;
  }

  /** A cancelled or done project is read only. */
  get isClosed(): boolean {
    return this.cancelledAt !== null || this.doneAt !== null;
  }

  /** True when a supplier already said yes to an order of this project. */
  get hasAcceptedOrder(): boolean {
    return this.activeOrderCount > this.pendingOrderCount;
  }

  /**
   * True while an order waits or is accepted. The dates, the place and the booth then
   * cannot change, because a supplier answers (or answered) for these facts.
   */
  get eventLocked(): boolean {
    return this.pendingOrderCount + this.acceptedOrderCount > 0;
  }

  toPublic() {
    return {
      id: this.id,
      companyId: this.companyId,
      companyName: this.companyName,
      name: this.name,
      venue: this.venue,
      city: this.city,
      hall: this.hall,
      boothNumber: this.boothNumber,
      boothWidthCm: this.boothWidthCm,
      boothDepthCm: this.boothDepthCm,
      startsOn: this.startsOn,
      endsOn: this.endsOn,
      setupOn: this.setupOn,
      notes: this.notes,
      status: this.status,
      eventLocked: this.eventLocked,
      orderCount: this.orderCount,
      pendingOrderCount: this.pendingOrderCount,
      lineCount: this.lineCount,
      totalCents: this.totalCents,
      cancelledAt: this.cancelledAt,
      doneAt: this.doneAt,
      createdBy: this.createdBy,
      createdByAdminName: this.createdByAdminName,
      createdAt: this.createdAt,
    };
  }
}
