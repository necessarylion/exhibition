import { z } from "@hono/zod-openapi";
import { Role } from "../constants/role.constants";
import { PageQuerySchema } from "./page.schema";

export const UserSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string(),
    role: z.enum([Role.Admin, Role.Supplier, Role.Customer]),
    isOwner: z.boolean().openapi({ description: "The main user of the company." }),
    companyApproved: z.boolean().openapi({
      description: "False while a supplier that signed up by itself waits for an admin.",
    }),
    name: z.string(),
    email: z.email(),
    actingAdmin: z.object({ id: z.uuid(), name: z.string() }).nullable().openapi({
      description:
        "Set when a platform admin acts as this user with the token of the request. Else `null`.",
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi("User");

export const UserListQuerySchema = z.object({
  companyId: z.uuid().optional().openapi({
    description: "Leave it out for my own company. Only an admin can name another company.",
  }),
  ...PageQuerySchema.shape,
});

export const UserParamSchema = z.object({ id: z.uuid() });

export type UserListQuery = z.infer<typeof UserListQuerySchema>;
export type UserParam = z.infer<typeof UserParamSchema>;
