import type { ItemUnit } from "../constants/item.constants";
import type { Role } from "../constants/role.constants";
import type { Overbooked } from "../services/bookings";
import type { ItemPhoto } from "./item-photo.model";

/** An `items` row joined with its owner company. */
export interface ItemRow {
  id: string;
  company_id: string;
  company_name: string;
  company_type: Role;
  name: string;
  category: string;
  description: string;
  price_cents: number;
  hidden_at: string | null;
  created_at: string;
  sku: string | null;
  unit: ItemUnit;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  weight_grams: number | null;
  color: string | null;
  material: string | null;
  stock: number | null;
  /** The profile of the owner company. Only the queries for one item select it. */
  company_phone?: string;
  company_website?: string;
  company_about?: string;
}

export class Item {
  sku: string | null = null;
  unit: ItemUnit = "piece";
  widthCm: number | null = null;
  heightCm: number | null = null;
  depthCm: number | null = null;
  weightGrams: number | null = null;
  color: string | null = null;
  material: string | null = null;
  /** How many the company has in total. An order never lowers it. `null` means no limit. */
  stock: number | null = null;
  /** How many are in accepted and completed orders on the dates that were asked for. */
  reserved = 0;
  /**
   * The days from today on where accepted orders hold more than the stock. It happens when
   * the owner lowers the stock. Only the owner gets it. Empty for everybody else.
   */
  overbooked: Overbooked[] = [];
  /** How many are in the project that was asked for, in lines that are not sent yet. */
  inProject = 0;
  /** The public profile of the owner company. Empty in the lists. */
  companyPhone = "";
  companyWebsite = "";
  companyAbout = "";
  /** How many orders hold this item. Only the list of my items fills it. */
  orderCount = 0;
  /** In order. The first one is the cover. The repository fills it. */
  photos: ItemPhoto[] = [];

  constructor(
    readonly id: string,
    readonly companyId: string,
    readonly companyName: string,
    readonly companyType: Role,
    public name: string,
    public category: string,
    public description: string,
    public priceCents: number,
    readonly createdAt: string,
    public hiddenAt: string | null = null,
  ) {}

  static fromRow(row: ItemRow): Item {
    const item = new Item(
      row.id,
      row.company_id,
      row.company_name,
      row.company_type,
      row.name,
      row.category,
      row.description,
      // PostgreSQL can return an INTEGER as a string. Make sure it is a number.
      Number(row.price_cents),
      row.created_at,
      row.hidden_at,
    );
    item.sku = row.sku;
    item.unit = row.unit;
    item.widthCm = Item.numberOrNull(row.width_cm);
    item.heightCm = Item.numberOrNull(row.height_cm);
    item.depthCm = Item.numberOrNull(row.depth_cm);
    item.weightGrams = Item.numberOrNull(row.weight_grams);
    item.color = row.color;
    item.material = row.material;
    item.stock = Item.numberOrNull(row.stock);
    item.companyPhone = row.company_phone ?? "";
    item.companyWebsite = row.company_website ?? "";
    item.companyAbout = row.company_about ?? "";
    return item;
  }

  /** How many are free on the dates that were asked for. `null` means no limit. */
  get available(): number | null {
    return this.stock === null ? null : Math.max(0, this.stock - this.reserved);
  }

  toPublic() {
    const photos = [];
    for (const photo of this.photos) {
      photos.push(photo.toPublic());
    }
    return {
      id: this.id,
      companyId: this.companyId,
      companyName: this.companyName,
      companyType: this.companyType,
      name: this.name,
      category: this.category,
      description: this.description,
      priceCents: this.priceCents,
      sku: this.sku,
      unit: this.unit,
      widthCm: this.widthCm,
      heightCm: this.heightCm,
      depthCm: this.depthCm,
      // The database keeps whole grams. The API speaks kilograms.
      weightKg: this.weightGrams === null ? null : this.weightGrams / 1000,
      color: this.color,
      material: this.material,
      stock: this.stock,
      available: this.available,
      inProject: this.inProject,
      overbooked: this.overbooked,
      hiddenAt: this.hiddenAt,
      photos,
      // The cover. The list pages show only this one.
      photoUrl: photos[0]?.url ?? null,
      createdAt: this.createdAt,
    };
  }

  /** One row of "My items". */
  toMine() {
    return { ...this.toPublic(), orderCount: this.orderCount };
  }

  /** One item with the public profile of its company. A customer reads it to reach a supplier. */
  toDetail() {
    return {
      ...this.toPublic(),
      companyPhone: this.companyPhone,
      companyWebsite: this.companyWebsite,
      companyAbout: this.companyAbout,
    };
  }

  private static numberOrNull(value: number | null): number | null {
    return value === null ? null : Number(value);
  }
}
