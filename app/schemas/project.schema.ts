import { z } from "@hono/zod-openapi";
import { ITEM_UNITS } from "../constants/item.constants";
import { ORDER_STATUSES } from "../constants/order.constants";
import { LINE_STATES, MAX_LINE_QUANTITY, PROJECT_STATUSES } from "../constants/project.constants";
import { date, id, text, whole } from "./fields";
import { dateText, OrderWithLinesSchema } from "./order.schema";
import { PageQuerySchema } from "./page.schema";

const MAX_SIZE_CM = 100_000;
const cents = z.int().openapi({ description: "Money in whole cents." });

export const ProjectSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string().openapi({ description: "The customer company." }),
    name: z.string(),
    venue: z.string(),
    city: z.string(),
    hall: z.string(),
    boothNumber: z.string(),
    boothWidthCm: z.int().nullable(),
    boothDepthCm: z.int().nullable(),
    startsOn: dateText,
    endsOn: dateText,
    setupOn: dateText.nullable(),
    notes: z.string(),
    status: z.enum(PROJECT_STATUSES).openapi({
      description:
        "draft: no open order. waiting: an order waits for an answer. confirmed: every open order is accepted.",
    }),
    eventLocked: z.boolean().openapi({
      description:
        "True while an order is pending or accepted. The dates, the place and the booth then cannot change.",
    }),
    orderCount: z.int().openapi({ description: "Every order, also rejected and cancelled ones." }),
    pendingOrderCount: z.int(),
    lineCount: z.int(),
    totalCents: cents.openapi({
      description: "The sum of the pending, accepted and completed orders.",
    }),
    cancelledAt: z.iso.datetime().nullable(),
    doneAt: z.iso.datetime().nullable(),
    createdBy: z.uuid().nullable(),
    createdByAdminName: z.string().nullable().openapi({
      description: "Set when a platform admin made it while acting as the customer.",
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Project");

export const ProjectLineSchema = z
  .object({
    id: z.uuid(),
    itemId: z.uuid(),
    itemName: z.string(),
    category: z.string(),
    sku: z.string().nullable(),
    photoUrl: z.string().nullable().openapi({ description: "The cover photo of the item." }),
    unit: z.enum(ITEM_UNITS),
    companyId: z.uuid().openapi({ description: "The company that owns the item." }),
    companyName: z.string(),
    quantity: z.int(),
    unitPriceCents: cents.openapi({
      description:
        "0 for an own or a shared item. The order price for a sent line. Else the price now.",
    }),
    lineTotalCents: cents,
    stock: z.int().nullable().openapi({ description: "The total stock. `null` means no limit." }),
    available: z.int().nullable().openapi({
      description:
        "How many are free on the dates of this project. For an own or a shared line it is the stock. `null` means no limit.",
    }),
    inCatalog: z.boolean().openapi({
      description:
        "False when the item is hidden, or its company is disabled or waits for approval. Such a line cannot be sent.",
    }),
    state: z.enum(LINE_STATES).openapi({
      description:
        "own: my item. shared: an item of a company in my organization group. Both are free and are never in an order. not_sent: not in an order yet. sent: in an order.",
    }),
    orderId: z.uuid().nullable(),
    orderStatus: z.enum(ORDER_STATUSES).nullable(),
  })
  .openapi("ProjectLine");

export const ProjectDetailSchema = z
  .object({
    project: ProjectSchema,
    lines: z.array(ProjectLineSchema),
    orders: z.array(OrderWithLinesSchema),
  })
  .openapi("ProjectDetail");

// A field that can be `null` is optional for the project. Send `null` to clear it.
const fields = {
  name: text("Project name", 100, { min: 1 }),
  venue: text("Venue", 150).openapi({ description: "The place of the exhibition." }),
  city: text("City", 100),
  hall: text("Hall", 50),
  boothNumber: text("Booth number", 50),
  boothWidthCm: whole("Booth width", 1, MAX_SIZE_CM).nullable(),
  boothDepthCm: whole("Booth depth", 1, MAX_SIZE_CM).nullable(),
  startsOn: date("Start date"),
  endsOn: date("End date").openapi({ description: "Not before `startsOn`." }),
  setupOn: date("Setup date").nullable().openapi({ description: "Not after `startsOn`." }),
  notes: text("Notes", 2000, { manyLines: true }),
};

export const UpdateProjectSchema = z.object(fields).partial().openapi("UpdateProjectInput");

export const CreateProjectSchema = z
  .object(fields)
  .partial()
  .extend({ name: fields.name, startsOn: fields.startsOn, endsOn: fields.endsOn })
  .openapi("CreateProjectInput");

const quantity = whole("Quantity", 1, MAX_LINE_QUANTITY);

export const AddLineSchema = z.object({ itemId: id("Item"), quantity }).openapi("AddLineInput");
export const UpdateLineSchema = z.object({ quantity }).openapi("UpdateLineInput");

export const SendProjectSchema = z
  .object({
    note: text("Note", 1000, { manyLines: true })
      .optional()
      .openapi({ description: "It is stored on every order of this send." }),
    expectedTotalCents: whole("Expected total", 0, Number.MAX_SAFE_INTEGER).openapi({
      description:
        "The total of the new orders that the customer saw. When the real total is different, nothing is sent.",
    }),
  })
  .openapi("SendProjectInput");

export const AddAgainSchema = ProjectDetailSchema.extend({
  notAdded: z.array(z.string()).openapi({
    description: "One plain sentence per item of the order that could not be added.",
  }),
}).openapi("AddAgainResult");

export const ProjectListQuerySchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  open: z.enum(["true"]).optional().openapi({
    description:
      "`true` gives only the projects that can still get items (not done, not cancelled).",
  }),
  hasWaitingOrders: z.enum(["true"]).optional().openapi({
    description: "`true` gives only the projects with an order that waits for an answer.",
  }),
  ...PageQuerySchema.shape,
});
export const ProjectOrderParamSchema = z.object({ id: z.uuid(), orderId: z.uuid() });
export const ProjectParamSchema = z.object({ id: z.uuid() });
export const ProjectLineParamSchema = z.object({ id: z.uuid(), lineId: z.uuid() });

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type AddLineInput = z.infer<typeof AddLineSchema>;
export type UpdateLineInput = z.infer<typeof UpdateLineSchema>;
export type SendProjectInput = z.infer<typeof SendProjectSchema>;
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
export type ProjectParam = z.infer<typeof ProjectParamSchema>;
export type ProjectLineParam = z.infer<typeof ProjectLineParamSchema>;
export type ProjectOrderParam = z.infer<typeof ProjectOrderParamSchema>;
