import { singleton } from "tsyringe";
import { ErrorCode } from "../constants/api.constants";
import { MAX_COMPANY_ITEMS, MAX_ITEM_PHOTOS } from "../constants/item.constants";
import { Role } from "../constants/role.constants";
import { DAY_MS } from "../constants/time.constants";
import { AppError } from "../errors/app.error";
import { isUniqueViolation } from "../errors/unique-violation";
import { Item } from "../models/item.model";
import { ItemPhoto } from "../models/item-photo.model";
import type { User } from "../models/user.model";
import { type ItemFilter, ItemRepository } from "../repositories/item.repository";
import { ProjectRepository } from "../repositories/project.repository";
import type { CreateItemInput, UpdateItemInput } from "../schemas/item.schema";
import type { Page, PageQuery } from "../schemas/page.schema";
import { overbooked } from "./bookings";
import { Clock } from "./clock.service";
import { PhotoStorageService } from "./photo-storage.service";

@singleton()
export class ItemService {
  constructor(
    private readonly items: ItemRepository,
    private readonly photos: PhotoStorageService,
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
  ) {}

  /** Every item of every company. For the admin. */
  listAll(page: PageQuery): Promise<Page<Item>> {
    return this.items.listAll(page);
  }

  async listMine(user: User, page: PageQuery, filter: ItemFilter = {}): Promise<Page<Item>> {
    const result = await this.items.listByCompany(user.companyId, page, filter);
    await this.attachOverbooked(result.rows);
    return result;
  }

  /** The categories of my items, or of my catalog. */
  categories(user: User, catalog: boolean): Promise<string[]> {
    return this.items.categories(user.companyId, catalog && user.role === Role.Customer);
  }

  /**
   * The items a customer can add to a project.
   * With a project, `available` of each item is for the dates of that project.
   */
  async listCatalog(
    user: User,
    page: PageQuery,
    filter: ItemFilter = {},
    projectId?: string,
  ): Promise<Page<Item>> {
    const result = await this.items.listCatalog(user.companyId, page, filter);
    await this.attachReserved(user, result.rows, projectId);
    return result;
  }

  /**
   * One item. A user sees the items of their company. An admin sees every item.
   * A customer also sees the items of their catalog.
   */
  async get(user: User, id: string, projectId?: string): Promise<Item> {
    let item = await this.items.findById(id);
    if (item && item.companyId !== user.companyId && user.role !== Role.Admin) {
      item =
        user.role === Role.Customer ? await this.items.findInCatalog(user.companyId, id) : null;
    }
    if (!item) {
      throw new AppError(404, ErrorCode.NotFound, "Item not found.");
    }
    await this.attachReserved(user, [item], projectId);
    if (item.companyId === user.companyId) {
      await this.attachOverbooked([item]);
    }
    return item;
  }

  /**
   * The stock can go below what accepted orders already hold: things break. The orders
   * stay as they are, and the owner sees the days that are now over-booked.
   */
  private async attachOverbooked(items: Item[]): Promise<void> {
    const ids: string[] = [];
    for (const item of items) {
      if (item.stock !== null) {
        ids.push(item.id);
      }
    }
    // "Yesterday in UTC" is today somewhere, so that day still counts.
    const from = new Date(this.clock.now() - DAY_MS).toISOString().slice(0, 10);
    const bookings = await this.items.bookings(ids, from, null);
    for (const item of items) {
      const list = bookings.get(item.id);
      item.overbooked = list && item.stock !== null ? overbooked(list, item.stock, from) : [];
    }
  }

  /**
   * Sets how many of each item are taken on the dates of the project.
   * The items of a customer company are not checked by date, so they keep 0. In a catalog
   * these are my own items and the items that my organization group shares.
   */
  private async attachReserved(user: User, items: Item[], projectId?: string): Promise<void> {
    if (!projectId) {
      return;
    }
    const project = await this.projects.findById(projectId);
    // A project of another company counts as not found. This does not reveal that it exists.
    if (!project || project.companyId !== user.companyId) {
      throw new AppError(404, ErrorCode.NotFound, "Project not found.");
    }
    const ids: string[] = [];
    for (const item of items) {
      if (item.companyType !== Role.Customer) {
        ids.push(item.id);
      }
    }
    const reserved = await this.items.reserved(ids, project.reservedFrom, project.endsOn);
    const inProject = new Map<string, number>();
    for (const line of await this.projects.listLines(projectId)) {
      if (!line.orderId) {
        inProject.set(line.itemId, line.quantity);
      }
    }
    for (const item of items) {
      item.reserved = reserved.get(item.id) ?? 0;
      item.inProject = inProject.get(item.id) ?? 0;
    }
  }

  async create(user: User, input: CreateItemInput): Promise<Item> {
    // ponytail: two creates at the same moment can both pass and give 5001 items.
    // The cap only stops one account from filling the database, so that is fine.
    if ((await this.items.countByCompany(user.companyId)) >= MAX_COMPANY_ITEMS) {
      throw new AppError(
        409,
        ErrorCode.TooManyItems,
        `A company can have up to ${MAX_COMPANY_ITEMS} items.`,
      );
    }
    const item = new Item(
      crypto.randomUUID(),
      user.companyId,
      user.companyName,
      user.role,
      input.name,
      input.category,
      "",
      input.priceCents,
      new Date().toISOString(),
    );
    await this.apply(item, input);
    await this.save(this.items.create(item));
    return item;
  }

  async update(user: User, id: string, input: UpdateItemInput): Promise<Item> {
    const item = await this.findOwn(user, id);
    await this.apply(item, input);
    // Only the fields of the input are saved. A stock that was not sent is never written.
    const fields = Object.keys(input) as (keyof UpdateItemInput)[];
    await this.save(this.items.update(item, fields));
    await this.attachOverbooked([item]);
    return item;
  }

  /** Adds a photo at the end. The first photo of an item is its cover. */
  async addPhoto(user: User, id: string, file: File): Promise<Item> {
    const item = await this.findOwn(user, id);
    // ponytail: two uploads at the same moment can pass this check together and give
    // the item 9 photos. Count inside a transaction if that ever matters.
    if (item.photos.length >= MAX_ITEM_PHOTOS) {
      throw new AppError(
        409,
        ErrorCode.TooManyPhotos,
        `An item can have up to ${MAX_ITEM_PHOTOS} photos.`,
      );
    }
    const last = item.photos.at(-1);
    const photo = new ItemPhoto(
      crypto.randomUUID(),
      item.id,
      await this.photos.save(file),
      last ? last.position + 1 : 0,
      new Date().toISOString(),
    );
    await this.items.addPhoto(photo);
    item.photos.push(photo);
    return item;
  }

  /** Removes the photo and its file. */
  async removePhoto(user: User, id: string, photoId: string): Promise<Item> {
    const item = await this.findOwn(user, id);
    const photo = this.findPhoto(item, photoId);
    await this.items.removePhoto(photo.id);
    await this.photos.remove(photo.file);
    item.photos.splice(item.photos.indexOf(photo), 1);
    return item;
  }

  /** Moves the photo to the first place. The other photos keep their order. */
  async setCover(user: User, id: string, photoId: string): Promise<Item> {
    const item = await this.findOwn(user, id);
    const photo = this.findPhoto(item, photoId);
    const cover = item.photos[0];
    if (cover && cover !== photo) {
      // One step before the first photo. Positions can go below 0, only their order counts.
      await this.items.setPhotoPosition(photo.id, cover.position - 1);
      item.photos.splice(item.photos.indexOf(photo), 1);
      item.photos.unshift(photo);
    }
    return item;
  }

  /** Puts the input on the item. A field that is not in the input stays as it is. */
  private async apply(item: Item, input: UpdateItemInput): Promise<void> {
    const { hidden, weightKg, ...sameName } = input;
    if (sameName.sku && sameName.sku !== item.sku) {
      const takenBy = await this.items.findIdBySku(item.companyId, sameName.sku);
      if (takenBy && takenBy !== item.id) {
        throw this.skuTaken();
      }
    }
    // These fields have the same name on the item. `null` clears an optional field.
    Object.assign(item, sameName);
    if (weightKg !== undefined) {
      item.weightGrams = weightKg === null ? null : Math.round(weightKg * 1000);
    }
    if (hidden === true) {
      item.hiddenAt ??= new Date().toISOString();
    }
    if (hidden === false) {
      item.hiddenAt = null;
    }
  }

  /**
   * Two requests at the same moment can both pass the SKU check in `apply`.
   * The UNIQUE index is the real guard. Its error becomes a 409.
   */
  private async save(write: Promise<void>): Promise<void> {
    try {
      await write;
    } catch (error) {
      throw isUniqueViolation(error) ? this.skuTaken() : error;
    }
  }

  private skuTaken(): AppError {
    return new AppError(409, ErrorCode.SkuTaken, "Another item of yours has this SKU.");
  }

  private findPhoto(item: Item, photoId: string): ItemPhoto {
    for (const photo of item.photos) {
      if (photo.id === photoId) {
        return photo;
      }
    }
    throw new AppError(404, ErrorCode.NotFound, "Photo not found.");
  }

  private async findOwn(user: User, id: string): Promise<Item> {
    const item = await this.items.findById(id);
    // An item of another company counts as not found. This does not reveal that it exists.
    if (!item || item.companyId !== user.companyId) {
      throw new AppError(404, ErrorCode.NotFound, "Item not found.");
    }
    return item;
  }
}
