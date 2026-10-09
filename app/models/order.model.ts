import { OrderStatus } from "../constants/order.constants";
import type { OrderLine } from "./order-line.model";

/** An `orders` row joined with both companies. The event columns are on the order itself. */
export interface OrderRow {
  id: string;
  number: string;
  project_id: string;
  customer_company_id: string;
  supplier_company_id: string;
  status: OrderStatus;
  note: string;
  reject_reason: string | null;
  total_cents: number;
  decided_at: string | null;
  decided_by: string | null;
  completed_at: string | null;
  created_at: string;
  customer_company_name: string;
  supplier_company_name: string;
  /** The email of the owner of the customer company. */
  customer_contact_email: string | null;
  customer_contact_name: string | null;
  customer_phone: string;
  /** The owner of the supplier company. */
  supplier_contact_email: string | null;
  supplier_contact_name: string | null;
  supplier_phone: string;
  line_count: number;
  project_name: string;
  venue: string;
  city: string;
  hall: string;
  booth_number: string;
  booth_width_cm: number | null;
  booth_depth_cm: number | null;
  starts_on: string;
  ends_on: string;
  setup_on: string | null;
  project_notes: string;
  cancelled_by: CancelledBy | null;
  created_by_admin_id: string | null;
  created_by_admin_name: string | null;
}

/** Who cancelled an order. */
export type CancelledBy = "customer" | "supplier" | "admin";

/**
 * The facts of the event that the supplier needs, copied when the order was sent.
 * `id` is the id of the project.
 */
export interface OrderEvent {
  id: string;
  name: string;
  venue: string;
  city: string;
  hall: string;
  boothNumber: string;
  boothWidthCm: number | null;
  boothDepthCm: number | null;
  startsOn: string;
  endsOn: string;
  setupOn: string | null;
  notes: string;
}

export class Order {
  status: OrderStatus = OrderStatus.Pending;
  rejectReason: string | null = null;
  decidedAt: string | null = null;
  decidedBy: string | null = null;
  completedAt: string | null = null;
  customerContactEmail: string | null = null;
  customerContactName: string | null = null;
  customerPhone = "";
  supplierContactEmail: string | null = null;
  supplierContactName: string | null = null;
  supplierPhone = "";
  lineCount = 0;
  /** Who cancelled it. `null` when it is not cancelled, and on an old order. */
  cancelledBy: CancelledBy | null = null;
  /** Set when a platform admin sent it while acting as the customer. */
  createdByAdminId: string | null = null;
  createdByAdminName: string | null = null;
  /** The repository fills it when the lines are needed. */
  lines: OrderLine[] = [];

  constructor(
    readonly id: string,
    /** It changes only when the first number was taken. */
    public number: string,
    readonly customerCompanyId: string,
    readonly customerCompanyName: string,
    readonly supplierCompanyId: string,
    readonly supplierCompanyName: string,
    readonly note: string,
    readonly totalCents: number,
    readonly createdAt: string,
    readonly event: OrderEvent,
  ) {}

  static fromRow(row: OrderRow): Order {
    const order = new Order(
      row.id,
      row.number,
      row.customer_company_id,
      row.customer_company_name,
      row.supplier_company_id,
      row.supplier_company_name,
      row.note,
      // PostgreSQL can return an INTEGER, a BIGINT or a COUNT as a string.
      Number(row.total_cents),
      row.created_at,
      {
        id: row.project_id,
        name: row.project_name,
        venue: row.venue,
        city: row.city,
        hall: row.hall,
        boothNumber: row.booth_number,
        boothWidthCm: row.booth_width_cm === null ? null : Number(row.booth_width_cm),
        boothDepthCm: row.booth_depth_cm === null ? null : Number(row.booth_depth_cm),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        setupOn: row.setup_on,
        notes: row.project_notes,
      },
    );
    order.status = row.status;
    order.rejectReason = row.reject_reason;
    order.decidedAt = row.decided_at;
    order.decidedBy = row.decided_by;
    order.completedAt = row.completed_at;
    order.customerContactEmail = row.customer_contact_email;
    order.customerContactName = row.customer_contact_name;
    order.customerPhone = row.customer_phone;
    order.supplierContactEmail = row.supplier_contact_email;
    order.supplierContactName = row.supplier_contact_name;
    order.supplierPhone = row.supplier_phone;
    order.lineCount = Number(row.line_count);
    order.cancelledBy = row.cancelled_by;
    order.createdByAdminId = row.created_by_admin_id;
    order.createdByAdminName = row.created_by_admin_name;
    return order;
  }

  get projectId(): string {
    return this.event.id;
  }

  /** One row of a list. */
  toPublic() {
    return {
      id: this.id,
      number: this.number,
      projectId: this.event.id,
      projectName: this.event.name,
      venue: this.event.venue,
      city: this.event.city,
      customerCompanyId: this.customerCompanyId,
      customerCompanyName: this.customerCompanyName,
      supplierCompanyId: this.supplierCompanyId,
      supplierCompanyName: this.supplierCompanyName,
      status: this.status,
      note: this.note,
      rejectReason: this.rejectReason,
      cancelledBy: this.cancelledBy,
      createdByAdminName: this.createdByAdminName,
      totalCents: this.totalCents,
      lineCount: this.lineCount,
      startsOn: this.event.startsOn,
      endsOn: this.event.endsOn,
      decidedAt: this.decidedAt,
      decidedBy: this.decidedBy,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
    };
  }

  toPublicWithLines() {
    const lines = [];
    for (const line of this.lines) {
      lines.push(line.toPublic());
    }
    return { ...this.toPublic(), lines };
  }

  /** The first day the items are away: the setup day, or the first day of the event. */
  get reservedFrom(): string {
    return this.event.setupOn ?? this.event.startsOn;
  }

  /**
   * The order with its lines, the event and the contact of both companies.
   * A rejected or cancelled order is no deal, so it shows no contact details.
   */
  toDetail() {
    const dead = this.status === OrderStatus.Rejected || this.status === OrderStatus.Cancelled;
    return {
      ...this.toPublicWithLines(),
      project: this.event,
      customerContactEmail: dead ? null : this.customerContactEmail,
      customerContactName: dead ? null : this.customerContactName,
      customerPhone: dead ? "" : this.customerPhone,
      supplierContactEmail: dead ? null : this.supplierContactEmail,
      supplierContactName: dead ? null : this.supplierContactName,
      supplierPhone: dead ? "" : this.supplierPhone,
    };
  }
}
