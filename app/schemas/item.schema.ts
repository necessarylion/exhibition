import { z } from "@hono/zod-openapi";
import { ITEM_UNITS } from "../constants/item.constants";
import { Role } from "../constants/role.constants";
import { id, text, whole } from "./fields";
import { PageQuerySchema } from "./page.schema";

const dateText = z.iso.date().openapi({ example: "2026-11-20" });
// The biggest number a PostgreSQL INTEGER column can hold.
const MAX_INTEGER = 2_147_483_647;
const MAX_SIZE_CM = 100_000;
const MAX_WEIGHT_KG = 100_000;

export const ItemSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string(),
    companyType: z.enum([Role.Admin, Role.Supplier, Role.Customer]),
    name: z.string(),
    category: z.string(),
    description: z.string(),
    priceCents: z.int().openapi({ description: "The price of one unit in whole cents." }),
    sku: z.string().nullable(),
    unit: z.enum(ITEM_UNITS),
    widthCm: z.int().nullable(),
    heightCm: z.int().nullable(),
    depthCm: z.int().nullable(),
    weightKg: z.number().nullable(),
    color: z.string().nullable(),
    material: z.string().nullable(),
    stock: z.int().nullable().openapi({
      description: "How many the company has in total. An order never lowers it. `null`: no limit.",
    }),
    available: z.int().nullable().openapi({
      description:
        "How many are free. With `projectId`: for the dates of that project. Else the stock.",
    }),
    inProject: z.int().openapi({
      description:
        "With `projectId`: how many are in that project already, in lines that are not sent. Else 0.",
    }),
    overbooked: z.array(z.object({ from: dateText, to: dateText, booked: z.int() })).openapi({
      description:
        "Only for the owner of the item: the days from today on where accepted orders hold more than the stock. `booked` is the highest total of one day.",
    }),
    hiddenAt: z.iso
      .datetime()
      .nullable()
      .openapi({ description: "Set when it is hidden from the catalog." }),
    photos: z
      .array(z.object({ id: z.uuid(), url: z.string().openapi({ example: "/uploads/2f1c.jpg" }) }))
      .openapi({ description: "In order. The first one is the cover." }),
    photoUrl: z.string().nullable().openapi({ description: "The cover photo." }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Item");

/** One row of the list of my items. */
export const MyItemSchema = ItemSchema.extend({
  orderCount: z.int().openapi({
    description: "How many waiting, accepted and completed orders hold this item.",
  }),
}).openapi("MyItem");

/** One item, with the public profile of the company that owns it. */
export const ItemDetailSchema = ItemSchema.extend({
  companyPhone: z.string().openapi({ description: "Empty when the company did not set it." }),
  companyWebsite: z.string(),
  companyAbout: z.string(),
}).openapi("ItemDetail");

// A field that can be `null` is optional for the item. Send `null` to clear it.
const fields = {
  name: text("Name", 100, { min: 1 }),
  category: text("Category", 50, { min: 1 }),
  description: text("Description", 1000, { manyLines: true }),
  priceCents: whole("Price", 0, MAX_INTEGER).openapi({ example: 4500 }),
  sku: text("SKU", 50, { min: 1 }).nullable().openapi({
    description: "Two items of one company cannot share it. Upper and lower case are the same.",
  }),
  unit: z.enum(ITEM_UNITS, "Choose a unit."),
  widthCm: whole("Width", 1, MAX_SIZE_CM).nullable(),
  heightCm: whole("Height", 1, MAX_SIZE_CM).nullable(),
  depthCm: whole("Depth", 1, MAX_SIZE_CM).nullable(),
  weightKg: z
    .number("Weight must be a number.")
    .min(0.001, "Weight is too low.")
    .max(MAX_WEIGHT_KG, "Weight is too high.")
    .multipleOf(0.001, "Weight can have up to 3 decimals.")
    .nullable()
    .openapi({ description: "Up to 3 decimals.", example: 12.5 }),
  color: text("Color", 50, { min: 1 }).nullable(),
  material: text("Material", 50, { min: 1 }).nullable(),
  stock: whole("Stock", 0, MAX_INTEGER).nullable().openapi({
    description: "How many the company has in total. `null` means there is no limit.",
  }),
  hidden: z.boolean().openapi({ description: "`true` takes it out of the catalog." }),
};

export const UpdateItemSchema = z.object(fields).partial().openapi("UpdateItemInput");

export const CreateItemSchema = z
  .object(fields)
  .partial()
  .extend({ name: fields.name, category: fields.category, priceCents: fields.priceCents })
  .openapi("CreateItemInput");

function isFile(value: unknown): boolean {
  return value instanceof File;
}

export const ItemPhotoSchema = z
  .object({
    photo: z.custom<File>(isFile, "Choose a photo file.").openapi({
      type: "string",
      format: "binary",
      description: "A JPG, PNG or WebP file, up to 5 MB.",
    }),
  })
  .openapi("ItemPhotoInput");

export const ItemParamSchema = z.object({ id: z.uuid() });

/** `projectId` asks for the availability on the dates of one of my projects. */
export const ItemProjectQuerySchema = z.object({
  projectId: id("Project").optional().openapi({
    description: "One of my projects. `available` is then worked out for its dates.",
  }),
});
const category = text("Category", 50).optional().openapi({
  description: "Only the items of this category.",
});
export const MyItemsQuerySchema = z.object({ category, ...PageQuerySchema.shape });
export const CatalogQuerySchema = z.object({
  ...ItemProjectQuerySchema.shape,
  category,
  owner: z.enum(["supplier", "shared", "own"]).optional().openapi({
    description:
      "supplier: items of suppliers and of the platform. shared: items of my organization group. own: my own items.",
  }),
  ...PageQuerySchema.shape,
});
export const CategoryQuerySchema = z.object({
  scope: z.enum(["mine", "catalog"]).default("mine").openapi({
    description: "mine: the categories of my items. catalog: of the items a customer can add.",
  }),
});
export const ItemPhotoParamSchema = z.object({ id: z.uuid(), photoId: z.uuid() });

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type ItemPhotoInput = z.infer<typeof ItemPhotoSchema>;
export type ItemProjectQuery = z.infer<typeof ItemProjectQuerySchema>;
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;
export type MyItemsQuery = z.infer<typeof MyItemsQuerySchema>;
export type CategoryQuery = z.infer<typeof CategoryQuerySchema>;
export type ItemParam = z.infer<typeof ItemParamSchema>;
export type ItemPhotoParam = z.infer<typeof ItemPhotoParamSchema>;
