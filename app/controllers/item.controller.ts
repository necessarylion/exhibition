import type { Context } from "hono";
import { singleton } from "tsyringe";
import { COUNTS_HEADER, TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type { Item } from "../models/item.model";
import type {
  CatalogQuery,
  CategoryQuery,
  CreateItemInput,
  ItemParam,
  ItemPhotoInput,
  ItemPhotoParam,
  ItemProjectQuery,
  MyItemsQuery,
  UpdateItemInput,
} from "../schemas/item.schema";
import type { Page, PageQuery } from "../schemas/page.schema";
import { ItemService } from "../services/item.service";

type CreateContext = Context<
  AppEnv,
  string,
  { in: { json: CreateItemInput }; out: { json: CreateItemInput } }
>;
type UpdateContext = Context<
  AppEnv,
  string,
  {
    in: { param: ItemParam; json: UpdateItemInput };
    out: { param: ItemParam; json: UpdateItemInput };
  }
>;

type ListContext = Context<AppEnv, string, { in: { query: PageQuery }; out: { query: PageQuery } }>;
type MineContext = Context<
  AppEnv,
  string,
  { in: { query: MyItemsQuery }; out: { query: MyItemsQuery } }
>;
type CategoryContext = Context<
  AppEnv,
  string,
  { in: { query: CategoryQuery }; out: { query: CategoryQuery } }
>;
type CatalogContext = Context<
  AppEnv,
  string,
  { in: { query: CatalogQuery }; out: { query: CatalogQuery } }
>;
type ItemContext = Context<
  AppEnv,
  string,
  {
    in: { param: ItemParam; query: ItemProjectQuery };
    out: { param: ItemParam; query: ItemProjectQuery };
  }
>;
type PhotoContext = Context<
  AppEnv,
  string,
  { in: { param: ItemPhotoParam }; out: { param: ItemPhotoParam } }
>;
type AddPhotoContext = Context<
  AppEnv,
  string,
  {
    in: { param: ItemParam; form: ItemPhotoInput };
    out: { param: ItemParam; form: ItemPhotoInput };
  }
>;

@singleton()
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  async listAll(c: ListContext) {
    return this.toList(c, await this.itemService.listAll(c.req.valid("query")));
  }

  async listMine(c: MineContext) {
    const query = c.req.valid("query");
    const page = await this.itemService.listMine(c.get("user"), query, query);
    const result = [];
    for (const item of page.rows) {
      result.push(item.toMine());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    c.header(COUNTS_HEADER, JSON.stringify(page.counts ?? {}));
    return c.json(result, 200);
  }

  async categories(c: CategoryContext) {
    const catalog = c.req.valid("query").scope === "catalog";
    return c.json(await this.itemService.categories(c.get("user"), catalog), 200);
  }

  async listCatalog(c: CatalogContext) {
    const query = c.req.valid("query");
    return this.toList(
      c,
      await this.itemService.listCatalog(c.get("user"), query, query, query.projectId),
    );
  }

  async get(c: ItemContext) {
    const item = await this.itemService.get(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("query").projectId,
    );
    return c.json(item.toDetail(), 200);
  }

  async create(c: CreateContext) {
    const item = await this.itemService.create(c.get("user"), c.req.valid("json"));
    return c.json(item.toPublic(), 201);
  }

  async update(c: UpdateContext) {
    const item = await this.itemService.update(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(item.toPublic(), 200);
  }

  async addPhoto(c: AddPhotoContext) {
    const item = await this.itemService.addPhoto(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("form").photo,
    );
    return c.json(item.toPublic(), 200);
  }

  async removePhoto(c: PhotoContext) {
    const { id, photoId } = c.req.valid("param");
    const item = await this.itemService.removePhoto(c.get("user"), id, photoId);
    return c.json(item.toPublic(), 200);
  }

  async setCover(c: PhotoContext) {
    const { id, photoId } = c.req.valid("param");
    const item = await this.itemService.setCover(c.get("user"), id, photoId);
    return c.json(item.toPublic(), 200);
  }

  private toList(c: Context<AppEnv>, page: Page<Item>) {
    const result = [];
    for (const item of page.rows) {
      result.push(item.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    return c.json(result, 200);
  }
}
