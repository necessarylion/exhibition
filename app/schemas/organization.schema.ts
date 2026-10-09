import { z } from "@hono/zod-openapi";
import { name, text } from "./fields";

export const OrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: "True Group" }),
    createdAt: z.iso.datetime(),
    companies: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          contactEmail: z.email().nullable(),
          itemCount: z.int().openapi({ description: "Its items that are not hidden." }),
        }),
      )
      .openapi({ description: "The customer companies in the group, sorted by name." }),
  })
  .openapi("Organization");

export const OrganizationInputSchema = z
  .object({ name: name("Group name", 100) })
  .openapi("OrganizationInput");

export const OrganizationListQuerySchema = z.object({
  q: text("Search", 100).optional().openapi({
    description: "Only the groups with this text. Upper and lower case are the same.",
  }),
});

export const OrganizationParamSchema = z.object({ id: z.uuid() });
export const OrganizationCompanyParamSchema = z.object({ id: z.uuid(), companyId: z.uuid() });

export type OrganizationListQuery = z.infer<typeof OrganizationListQuerySchema>;
export type OrganizationInput = z.infer<typeof OrganizationInputSchema>;
export type OrganizationParam = z.infer<typeof OrganizationParamSchema>;
export type OrganizationCompanyParam = z.infer<typeof OrganizationCompanyParamSchema>;
