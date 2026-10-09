import type { ItemUnit } from "../constants/item.constants";
import type { OrderStatus } from "../constants/order.constants";
import { FREE_LINE_STATES, LineState } from "../constants/project.constants";
import { Role } from "../constants/role.constants";
import { UPLOADS_URL } from "../constants/upload.constants";

/** A `project_lines` row joined with its item, the owner of the item and its order. */
export interface ProjectLineRow {
  id: string;
  project_id: string;
  item_id: string;
  quantity: number;
  order_id: string | null;
  position: number;
  created_at: string;
  item_name: string;
  category: string;
  sku: string | null;
  unit: ItemUnit;
  price_cents: number;
  stock: number | null;
  owner_company_id: string;
  owner_company_name: string;
  owner_company_type: Role;
  item_hidden_at: string | null;
  owner_disabled_at: string | null;
  owner_approved_at: string | null;
  project_company_id: string;
  order_status: OrderStatus | null;
  /** The price in the order. Only a sent line has it. */
  sent_price_cents: number | null;
  /** The file of the cover photo of the item. */
  photo_file: string | null;
}

export class ProjectLine {
  /** How many of the item are in accepted and completed orders on the dates of the project. */
  reserved = 0;

  constructor(
    readonly id: string,
    readonly projectId: string,
    readonly itemId: string,
    public quantity: number,
    readonly orderId: string | null,
    readonly createdAt: string,
    readonly itemName: string,
    readonly unit: ItemUnit,
    /** The price of the item now. */
    readonly priceCents: number,
    readonly stock: number | null,
    readonly ownerCompanyId: string,
    readonly ownerCompanyName: string,
    readonly projectCompanyId: string,
    readonly orderStatus: OrderStatus | null,
    readonly sentPriceCents: number | null,
    readonly photoFile: string | null,
    readonly category: string,
    readonly sku: string | null,
    readonly ownerCompanyType: Role,
    /** False when the item is hidden, or its company is disabled or not approved. */
    readonly inCatalog: boolean,
  ) {}

  static fromRow(row: ProjectLineRow): ProjectLine {
    return new ProjectLine(
      row.id,
      row.project_id,
      row.item_id,
      // PostgreSQL can return an INTEGER as a string. Make sure it is a number.
      Number(row.quantity),
      row.order_id,
      row.created_at,
      row.item_name,
      row.unit,
      Number(row.price_cents),
      row.stock === null ? null : Number(row.stock),
      row.owner_company_id,
      row.owner_company_name,
      row.project_company_id,
      row.order_status,
      row.sent_price_cents === null ? null : Number(row.sent_price_cents),
      row.photo_file,
      row.category,
      row.sku,
      row.owner_company_type,
      !row.item_hidden_at && !row.owner_disabled_at && Boolean(row.owner_approved_at),
    );
  }

  get state(): LineState {
    if (this.orderId) {
      return LineState.Sent;
    }
    if (this.ownerCompanyId === this.projectCompanyId) {
      return LineState.Own;
    }
    // A customer gets the item of another customer only through its organization group.
    // The type of a company never changes, so the line stays `shared` after the company
    // leaves the group or the group is deleted.
    return this.ownerCompanyType === Role.Customer ? LineState.Shared : LineState.NotSent;
  }

  /** An own or a shared line: no price, no order, no check by date. */
  get isFree(): boolean {
    return FREE_LINE_STATES.includes(this.state);
  }

  /**
   * How many are free on the dates of the project. `null` means no limit.
   * An own or a shared item is not checked by date, so it shows the stock.
   */
  get available(): number | null {
    if (this.stock === null || this.isFree) {
      return this.stock;
    }
    return Math.max(0, this.stock - this.reserved);
  }

  /** An own or a shared item is free. A sent line keeps the price of its order. */
  get unitPriceCents(): number {
    if (this.isFree) {
      return 0;
    }
    return this.sentPriceCents ?? this.priceCents;
  }

  toPublic() {
    return {
      id: this.id,
      itemId: this.itemId,
      itemName: this.itemName,
      category: this.category,
      sku: this.sku,
      photoUrl: this.photoFile ? `${UPLOADS_URL}/${this.photoFile}` : null,
      unit: this.unit,
      companyId: this.ownerCompanyId,
      companyName: this.ownerCompanyName,
      quantity: this.quantity,
      unitPriceCents: this.unitPriceCents,
      lineTotalCents: this.unitPriceCents * this.quantity,
      stock: this.stock,
      available: this.available,
      inCatalog: this.inCatalog,
      state: this.state,
      orderId: this.orderId,
      orderStatus: this.orderStatus,
    };
  }
}
