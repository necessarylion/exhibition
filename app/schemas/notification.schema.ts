import { z } from "@hono/zod-openapi";

export const NotificationSchema = z
  .object({
    id: z.uuid(),
    text: z.string().openapi({
      example: "Booth Masters accepted order ORD-1A2B3C4D for Tech Expo 2027.",
    }),
    link: z.string().openapi({
      description: "The page of the app that it is about.",
      example: "/orders/0b0f6f0e-6d0c-4a43-9a53-4a8d1f0f6a11",
    }),
    readAt: z.iso.datetime().nullable().openapi({ description: "Empty while it is new." }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Notification");

export const NotificationParamSchema = z.object({ id: z.uuid() });

export type NotificationParam = z.infer<typeof NotificationParamSchema>;
