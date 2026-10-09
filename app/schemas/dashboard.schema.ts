import { z } from "@hono/zod-openapi";
import { ORDER_STATUSES } from "../constants/order.constants";
import { PROJECT_STATUSES } from "../constants/project.constants";
import { Role } from "../constants/role.constants";
import { dateText } from "./order.schema";

const cents = z.int().openapi({ description: "Money in whole cents." });

const orderRow = z
  .object({
    id: z.uuid(),
    number: z.string().openapi({ example: "ORD-1048" }),
    projectId: z.uuid(),
    customerCompanyName: z.string(),
    supplierCompanyName: z.string(),
    projectName: z.string(),
    startsOn: dateText.openapi({ description: "The first day of the event." }),
    endsOn: dateText,
    totalCents: cents,
    status: z.enum(ORDER_STATUSES),
    createdAt: z.iso.datetime(),
  })
  .openapi("DashboardOrder");

const projectRow = z
  .object({
    id: z.uuid(),
    name: z.string(),
    companyName: z.string().openapi({ description: "The customer company." }),
    venue: z.string().openapi({ description: "Empty when not set." }),
    city: z.string(),
    startsOn: dateText,
    endsOn: dateText,
    status: z.enum(PROJECT_STATUSES),
    createdAt: z.iso.datetime(),
  })
  .openapi("DashboardProject");

const supplierStats = {
  ordersWaiting: z.int().openapi({ description: "Pending orders for my items." }),
  ordersAccepted: z.int().openapi({ description: "Accepted orders that are not completed yet." }),
  revenueCents: cents.openapi({ description: "The sum of my accepted and completed orders." }),
  itemsListed: z.int().openapi({ description: "My items that are not hidden." }),
  itemsHidden: z.int(),
  ordersToAnswer: z
    .array(orderRow)
    .openapi({ description: "Up to 5 pending orders, newest first." }),
  ordersPerMonth: z
    .array(z.object({ month: z.string().openapi({ example: "2026-10" }), count: z.int() }))
    .openapi({ description: "The last 6 months in UTC, oldest first. The last is this month." }),
  topItems: z
    .array(
      z.object({
        itemId: z.uuid(),
        itemName: z.string(),
        category: z.string(),
        photoUrl: z.string().nullable().openapi({ description: "The cover photo of the item." }),
        orderCount: z.int().openapi({ description: "Accepted and completed orders with it." }),
        quantity: z.int(),
        revenueCents: cents,
      }),
    )
    .openapi({ description: "Up to 5 items by quantity in accepted and completed orders." }),
};

const CustomerDashboardSchema = z
  .object({
    role: z.literal(Role.Customer),
    projectsInProgress: z.int().openapi({ description: "Projects not cancelled and not done." }),
    projectsDraft: z.int(),
    projectsWaiting: z.int(),
    projectsConfirmed: z.int(),
    ordersWaiting: z.int(),
    ordersConfirmed: z.int().openapi({ description: "Accepted and completed orders." }),
    totalSpendCents: cents.openapi({ description: "The sum of accepted and completed orders." }),
    upcomingProjects: z.array(projectRow).openapi({
      description:
        "Up to 5 projects in progress that are not over yet. The first to start is first.",
    }),
    recentOrders: z.array(orderRow).openapi({ description: "Up to 5 orders, newest first." }),
  })
  .openapi("CustomerDashboard");

const SupplierDashboardSchema = z
  .object({ role: z.literal(Role.Supplier), ...supplierStats })
  .openapi("SupplierDashboard");

const AdminDashboardSchema = z
  .object({
    role: z.literal(Role.Admin),
    customers: z.int().openapi({ description: "Customer companies." }),
    customersDisabled: z.int().openapi({ description: "Customer companies that are disabled." }),
    suppliers: z.int().openapi({ description: "Supplier companies." }),
    suppliersWaiting: z.int().openapi({ description: "Suppliers that wait for approval." }),
    projects: z.int(),
    projectsWaiting: z.int().openapi({ description: "Projects with an order that waits." }),
    ordersWaiting: z.int().openapi({ description: "Pending orders of every company." }),
    orderValueCents: cents.openapi({
      description: "Accepted and completed orders, all companies.",
    }),
    recentProjects: z.array(projectRow).openapi({ description: "The 5 newest projects." }),
    recentOrders: z.array(orderRow).openapi({ description: "The 5 newest orders." }),
    newestCompanies: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        type: z.enum([Role.Admin, Role.Supplier, Role.Customer]),
        ownerName: z.string().nullable().openapi({ description: "`null`: it has no user." }),
        createdAt: z.iso.datetime(),
      }),
    ),
    asSupplier: z
      .object(supplierStats)
      .openapi({ description: "The orders for the items of the admin company." }),
  })
  .openapi("AdminDashboard");

/** `role` tells which of the three shapes it is. */
export const DashboardSchema = z
  .discriminatedUnion("role", [
    CustomerDashboardSchema,
    SupplierDashboardSchema,
    AdminDashboardSchema,
  ])
  .openapi("Dashboard");
