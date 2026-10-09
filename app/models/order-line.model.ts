import type { ItemUnit } from "../constants/item.constants";
import { UPLOADS_URL } from "../constants/upload.constants";

/** An `order_lines` row joined with the stock and the cover photo of its item. */
export interface OrderLineRow {
  id: string;
  order_id: string;
  item_id: string;
  item_name: string;
  unit: ItemUnit;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  category?: string | null;
  sku?: string | null;
  stock?: number | null;
  photo_file?: string | null;
}

export class OrderLine {
  /**
   * How many are free on the dates of the order. The service fills it for the company
   * that answers a waiting order. `null`: not worked out, or the item has no limit.
   */
  available: number | null = null;

  constructor(
    readonly id: string,
    readonly orderId: string,
    readonly itemId: string,
    /** The name, unit and price are copies from the moment of sending. */
    readonly itemName: string,
    readonly unit: ItemUnit,
    readonly unitPriceCents: number,
    readonly quantity: number,
    readonly lineTotalCents: number,
    /** Copies from the moment of sending too. A line from before these columns has `null`. */
    readonly category: string | null = null,
    readonly sku: string | null = null,
    /** The stock of the item now. `null` means there is no limit. */
    readonly stock: number | null = null,
    readonly photoFile: string | null = null,
  ) {}

  static fromRow(row: OrderLineRow): OrderLine {
    return new OrderLine(
      row.id,
      row.order_id,
      row.item_id,
      row.item_name,
      row.unit,
      // PostgreSQL can return an INTEGER or a BIGINT as a string.
      Number(row.unit_price_cents),
      Number(row.quantity),
      Number(row.line_total_cents),
      row.category ?? null,
      row.sku ?? null,
      row.stock === null || row.stock === undefined ? null : Number(row.stock),
      row.photo_file ?? null,
    );
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
      unitPriceCents: this.unitPriceCents,
      quantity: this.quantity,
      lineTotalCents: this.lineTotalCents,
      stock: this.stock,
      available: this.available,
    };
  }
}
