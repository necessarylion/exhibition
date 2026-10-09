import { UPLOADS_URL } from "../constants/upload.constants";

export interface ItemPhotoRow {
  id: string;
  item_id: string;
  file: string;
  position: number;
  created_at: string;
}

export class ItemPhoto {
  constructor(
    readonly id: string,
    readonly itemId: string,
    /** The file name in the uploads folder. */
    readonly file: string,
    /** The photo at the lowest position is the cover. */
    readonly position: number,
    readonly createdAt: string,
  ) {}

  static fromRow(row: ItemPhotoRow): ItemPhoto {
    // PostgreSQL can return an INTEGER as a string. Make sure it is a number.
    return new ItemPhoto(row.id, row.item_id, row.file, Number(row.position), row.created_at);
  }

  toPublic() {
    return { id: this.id, url: `${UPLOADS_URL}/${this.file}` };
  }
}
