import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { singleton } from "tsyringe";
import { API_PREFIX, BEARER_SCHEME } from "../constants/api.constants";
import { Role } from "../constants/role.constants";
import { ItemController } from "../controllers/item.controller";
import { type AppEnv, BearerAuthMiddleware } from "../middleware/bearer-auth.middleware";
import { RoleGuard } from "../middleware/role-guard.middleware";
import { errorResponse } from "../schemas/error.schema";
import {
  CatalogQuerySchema,
  CategoryQuerySchema,
  CreateItemSchema,
  ItemDetailSchema,
  ItemParamSchema,
  ItemPhotoParamSchema,
  ItemPhotoSchema,
  ItemProjectQuerySchema,
  ItemSchema,
  MyItemSchema,
  MyItemsQuerySchema,
  UpdateItemSchema,
} from "../schemas/item.schema";
import { PageQuerySchema } from "../schemas/page.schema";

@singleton()
export class ItemRoutes {
  private readonly adminOnly = new RoleGuard([Role.Admin]);
  private readonly customerOnly = new RoleGuard([Role.Customer]);

  constructor(
    private readonly controller: ItemController,
    private readonly bearerAuth: BearerAuthMiddleware,
  ) {}

  register(app: OpenAPIHono<AppEnv>): void {
    const bearer = this.bearerAuth.handle.bind(this.bearerAuth);
    const security = [{ [BEARER_SCHEME]: [] }];
    const unauthorized = errorResponse("The token is missing, wrong or expired.");
    const invalid = errorResponse("The input is not valid.");
    const notMine = errorResponse("The item or the photo does not exist, or it is not mine.");
    const itemResponse = {
      description: "The item.",
      content: { "application/json": { schema: ItemSchema } },
    };
    const itemsResponse = {
      description: "The items that match, sorted by name. `X-Total-Count` has their number.",
      content: { "application/json": { schema: z.array(ItemSchema) } },
    };

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/items/mine`,
        tags: ["Items"],
        summary: "List the items of my company, hidden ones too",
        security,
        middleware: [bearer],
        request: { query: MyItemsQuerySchema },
        responses: {
          200: {
            description:
              'The items that match, sorted by name. `X-Total-Count` has their number. `X-Counts` is JSON like `{"hidden":2}`: how many of them are hidden.',
            content: { "application/json": { schema: z.array(MyItemSchema) } },
          },
          401: unauthorized,
          422: invalid,
        },
      }),
      this.controller.listMine.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/items/categories`,
        tags: ["Items"],
        summary: "List the categories of my items, or of my catalog",
        security,
        middleware: [bearer],
        request: { query: CategoryQuerySchema },
        responses: {
          200: {
            description: "The category names, sorted. At most 200.",
            content: { "application/json": { schema: z.array(z.string()) } },
          },
          401: unauthorized,
          422: invalid,
        },
      }),
      this.controller.categories.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/items/catalog`,
        tags: ["Items"],
        summary: "List the items a customer can add to a project (customer only)",
        security,
        middleware: [bearer, this.customerOnly.handle.bind(this.customerOnly)],
        request: { query: CatalogQuerySchema },
        responses: {
          200: itemsResponse,
          401: unauthorized,
          403: errorResponse("Only a customer can do this."),
          404: errorResponse("The project of `projectId` does not exist, or it is not mine."),
          422: invalid,
        },
      }),
      this.controller.listCatalog.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/items`,
        tags: ["Items"],
        summary: "List every item of every company (admin only)",
        security,
        middleware: [bearer, this.adminOnly.handle.bind(this.adminOnly)],
        request: { query: PageQuerySchema },
        responses: {
          200: itemsResponse,
          401: unauthorized,
          403: errorResponse("Only an admin can do this."),
          422: invalid,
        },
      }),
      this.controller.listAll.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "get",
        path: `${API_PREFIX}/items/{id}`,
        tags: ["Items"],
        summary: "Get one item: of my company, of my catalog (customer), or any item (admin)",
        security,
        middleware: [bearer],
        request: { params: ItemParamSchema, query: ItemProjectQuerySchema },
        responses: {
          200: {
            description: "The item, with the public profile of its company.",
            content: { "application/json": { schema: ItemDetailSchema } },
          },
          401: unauthorized,
          404: errorResponse("The item does not exist, or you cannot see it."),
        },
      }),
      this.controller.get.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/items`,
        tags: ["Items"],
        summary: "Create an item in my company",
        security,
        middleware: [bearer],
        request: {
          body: { required: true, content: { "application/json": { schema: CreateItemSchema } } },
        },
        responses: {
          201: itemResponse,
          401: unauthorized,
          409: errorResponse(
            "Another item of my company has this SKU, or my company already has 5000 items.",
          ),
          422: invalid,
        },
      }),
      this.controller.create.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "patch",
        path: `${API_PREFIX}/items/{id}`,
        tags: ["Items"],
        summary: "Change, hide or show an item of my company",
        security,
        middleware: [bearer],
        request: {
          params: ItemParamSchema,
          body: { required: true, content: { "application/json": { schema: UpdateItemSchema } } },
        },
        responses: {
          200: itemResponse,
          401: unauthorized,
          404: errorResponse("The item does not exist, or it is not yours."),
          409: errorResponse("Another item of my company has this SKU."),
          422: invalid,
        },
      }),
      this.controller.update.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "post",
        path: `${API_PREFIX}/items/{id}/photos`,
        tags: ["Items"],
        summary: "Add one photo to one of my items. It goes to the end.",
        security,
        // The size limit of this upload is in `Application.limitBody`.
        middleware: [bearer],
        request: {
          params: ItemParamSchema,
          body: { required: true, content: { "multipart/form-data": { schema: ItemPhotoSchema } } },
        },
        responses: {
          200: itemResponse,
          401: unauthorized,
          404: notMine,
          409: errorResponse("The item already has 8 photos."),
          413: errorResponse("The photo is bigger than 5 MB."),
          422: errorResponse("The file is not a JPG, PNG or WebP photo."),
        },
      }),
      this.controller.addPhoto.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "delete",
        path: `${API_PREFIX}/items/{id}/photos/{photoId}`,
        tags: ["Items"],
        summary: "Remove a photo of one of my items",
        security,
        middleware: [bearer],
        request: { params: ItemPhotoParamSchema },
        responses: { 200: itemResponse, 401: unauthorized, 404: notMine },
      }),
      this.controller.removePhoto.bind(this.controller),
    );

    app.openapi(
      createRoute({
        method: "put",
        path: `${API_PREFIX}/items/{id}/photos/{photoId}/cover`,
        tags: ["Items"],
        summary: "Make a photo the cover of one of my items. It moves to the first place.",
        security,
        middleware: [bearer],
        request: { params: ItemPhotoParamSchema },
        responses: { 200: itemResponse, 401: unauthorized, 404: notMine },
      }),
      this.controller.setCover.bind(this.controller),
    );
  }
}
