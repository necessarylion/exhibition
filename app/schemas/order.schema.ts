import { z } from "@hono/zod-openapi";
import { ITEM_UNITS } from "../constants/item.constants";
import { ORDER_STATUSES } from "../constants/order.constants";
import { text } from "./fields";
import { PageQuerySchema } from "./page.schema";

const cents = z.int().openapi({ description: "Money in whole cents." });
export const dateText = z.iso.date().openapi({ example: "2026-11-20" });

export const OrderLineSchema = z
  .object({
    id: z.uuid(),
    itemId: z.uuid(),
    itemName: z.string().openapi({ description: "The name at the moment of sending." }),
    category: z.string().nullable().openapi({ description: "At the moment of sending." }),
    sku: z.string().nullable(),
    photoUrl: z.string().nullable().openapi({ description: "The cover photo of the item." }),
    unit: z.enum(ITEM_UNITS),
    unitPriceCents: cents.openapi({ description: "The price at the moment of sending." }),
    quantity: z.int(),
    lineTotalCents: cents,
    stock: z.int().nullable().openapi({
      description: "How many the owner has in total now. `null` means there is no limit.",
    }),
    available: z.int().nullable().openapi({
      description:
        "On a pending order, for the company that answers it and for an admin: how many are free on the dates of the order. `null`: no limit, or not worked out.",
    }),
  })
  .openapi("OrderLine");

const order = {
  id: z.uuid(),
  number: z.string().openapi({ example: "ORD-1048" }),
  projectId: z.uuid(),
  projectName: z.string().openapi({ description: "The name at the moment of sending." }),
  venue: z.string().openapi({ description: "The place of the event. Empty when not set." }),
  city: z.string(),
  customerCompanyId: z.uuid(),
  customerCompanyName: z.string(),
  supplierCompanyId: z.uuid().openapi({ description: "The company that owns the items." }),
  supplierCompanyName: z.string(),
  status: z.enum(ORDER_STATUSES),
  note: z.string().openapi({ description: "The note of the customer." }),
  rejectReason: z.string().nullable().openapi({
    description: "Why it was rejected, or why the supplier or an admin cancelled it.",
  }),
  cancelledBy: z.enum(["customer", "supplier", "admin"]).nullable().openapi({
    description: "Who cancelled it. `null` when it is not cancelled.",
  }),
  createdByAdminName: z.string().nullable().openapi({
    description: "Set when a platform admin sent it while acting as the customer.",
  }),
  totalCents: cents,
  lineCount: z.int(),
  startsOn: dateText,
  endsOn: dateText,
  decidedAt: z.iso
    .datetime()
    .nullable()
    .openapi({ description: "When it was accepted or rejected." }),
  decidedBy: z.uuid().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
};

export const OrderSchema = z.object(order).openapi("Order");

export const OrderWithLinesSchema = z
  .object({ ...order, lines: z.array(OrderLineSchema) })
  .openapi("OrderWithLines");

export const OrderDetailSchema = z
  .object({
    ...order,
    lines: z.array(OrderLineSchema),
    project: z
      .object({
        id: z.uuid(),
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
      })
      .openapi({
        description:
          "The facts of the event, copied at the moment of sending. A later change of the project does not change them.",
      }),
    customerContactEmail: z.email().nullable().openapi({
      description:
        "The email of the owner of the customer company. `null` on a rejected or cancelled order.",
    }),
    customerContactName: z.string().nullable(),
    customerPhone: z.string().openapi({ description: "Empty when the company did not set it." }),
    supplierContactEmail: z
      .email()
      .nullable()
      .openapi({ description: "The email of the owner of the supplier company." }),
    supplierContactName: z.string().nullable(),
    supplierPhone: z.string(),
  })
  .openapi("OrderDetail");

export const OrderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  ...PageQuerySchema.shape,
});

const reason = text("Reason", 1000, { min: 1, manyLines: true, required: "Write a reason." });

export const RejectOrderSchema = z.object({ reason }).openapi("RejectOrderInput");

export const CancelOrderSchema = z
  .object({
    reason: reason.optional().openapi({
      description:
        "Needed when the supplier cancels an accepted order, and when an admin cancels an order. The customer sends none.",
    }),
  })
  .openapi("CancelOrderInput");

export const OrderParamSchema = z.object({ id: z.uuid() });

export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
export type RejectOrderInput = z.infer<typeof RejectOrderSchema>;
export type OrderParam = z.infer<typeof OrderParamSchema>;
