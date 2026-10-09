import { z } from "@hono/zod-openapi";
import { Role } from "../constants/role.constants";
import { name, text } from "./fields";
import { PageQuerySchema } from "./page.schema";

const managedType = z.enum([Role.Supplier, Role.Customer]);

export const CompanySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum([Role.Admin, Role.Supplier, Role.Customer]),
    contactEmail: z.email().nullable().openapi({ description: "The email of the first user." }),
    disabledAt: z.iso.datetime().nullable().openapi({ description: "Set when it is disabled." }),
    approvedAt: z.iso.datetime().nullable().openapi({
      description:
        "Empty while a supplier that signed up by itself waits for an admin. Its items are in no catalog until then.",
    }),
    organizationId: z.uuid().nullable().openapi({ description: "Its organization group." }),
    organizationName: z.string().nullable(),
    pendingOrderCount: z.int().openapi({
      description:
        "Its orders, as supplier or as customer, that wait for an answer. Disabling the company cancels them.",
    }),
    acceptedOrderCount: z.int().openapi({
      description: "Its orders that are accepted. Disabling the company leaves them as they are.",
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Company");

export const CompanyListQuerySchema = z.object({
  type: managedType.openapi({ example: Role.Customer }),
  ungrouped: z.enum(["true"]).optional().openapi({
    description: "`true` gives only the companies that are in no organization group.",
  }),
  ...PageQuerySchema.shape,
});

export const CompanyParamSchema = z.object({ id: z.uuid() });

export const UpdateCompanySchema = z
  .object({
    name: name("Company name", 100).optional(),
    disabled: z.boolean().optional().openapi({
      description:
        "`true` blocks its users. Its orders that wait for an answer are cancelled, and the other company is told.",
    }),
  })
  .openapi("UpdateCompanyInput");

function isWebUrl(value: string): boolean {
  return value === "" || (/^https?:\/\//i.test(value) && URL.canParse(value));
}

// Empty text means not set.
const profile = {
  phone: text("Phone", 50).openapi({ example: "+95 9 123 456 789" }),
  address: text("Address", 300, { manyLines: true }),
  website: text("Website", 200)
    .refine(isWebUrl, "Use a link that starts with http:// or https://.")
    .openapi({ example: "https://example.com" }),
  about: text("About", 2000, { manyLines: true }),
};

/** What the users of a company see of their own company. */
export const CompanyProfileSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum([Role.Admin, Role.Supplier, Role.Customer]),
    phone: z.string(),
    address: z.string(),
    website: z.string(),
    about: z.string(),
    approvedAt: z.iso.datetime().nullable().openapi({
      description: "Empty while a supplier waits for an admin.",
    }),
    createdAt: z.iso.datetime(),
    organization: z
      .object({
        id: z.uuid(),
        name: z.string().openapi({ example: "True Group" }),
        companies: z
          .array(z.object({ id: z.uuid(), name: z.string() }))
          .openapi({ description: "Every company of the group, also mine." }),
      })
      .nullable()
      .openapi({
        description:
          "My organization group. Its companies share their items with each other for free.",
      }),
  })
  .openapi("CompanyProfile");

export const AdminActionSchema = z
  .object({
    id: z.uuid(),
    adminName: z.string().openapi({ example: "Su Su Hlaing" }),
    companyName: z.string().openapi({ description: "The customer the admin acted as." }),
    action: z.string().openapi({
      description:
        "`impersonate` for the start. After that the method and the path of each request that changed something.",
      example: "POST /projects/0b0f6f0e-6d0c-4a43-9a53-4a8d1f0f6a11/send",
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi("AdminAction");

export const UpdateMyCompanySchema = z
  .object({ name: name("Company name", 100), ...profile })
  .partial()
  .openapi("UpdateMyCompanyInput");

export type UpdateMyCompanyInput = z.infer<typeof UpdateMyCompanySchema>;
export type CompanyListQuery = z.infer<typeof CompanyListQuerySchema>;
export type CompanyParam = z.infer<typeof CompanyParamSchema>;
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
