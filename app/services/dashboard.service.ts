import { singleton } from "tsyringe";
import { DASHBOARD_LIST_SIZE, DASHBOARD_MONTHS } from "../constants/dashboard.constants";
import { OrderStatus } from "../constants/order.constants";
import { OPEN_PROJECT_STATUSES, ProjectSort, ProjectStatus } from "../constants/project.constants";
import { Role } from "../constants/role.constants";
import { DAY_MS } from "../constants/time.constants";
import type { Order } from "../models/order.model";
import type { Project } from "../models/project.model";
import type { User } from "../models/user.model";
import {
  DashboardRepository,
  type OrderSide,
  type OrderTotals,
} from "../repositories/dashboard.repository";
import { type OrderFilter, OrderRepository } from "../repositories/order.repository";
import { type ProjectFilter, ProjectRepository } from "../repositories/project.repository";
import { Clock } from "./clock.service";

const FIRST_ROWS = { limit: DASHBOARD_LIST_SIZE, offset: 0 };
const NOTHING: OrderTotals = { count: 0, totalCents: 0 };

/** The numbers and short lists of the first page. Every role gets its own shape. */
@singleton()
export class DashboardService {
  constructor(
    private readonly dashboard: DashboardRepository,
    private readonly projects: ProjectRepository,
    private readonly orders: OrderRepository,
    private readonly clock: Clock,
  ) {}

  async get(user: User) {
    if (user.role === Role.Customer) {
      return this.forCustomer(user.companyId);
    }
    if (user.role === Role.Supplier) {
      return { role: Role.Supplier, ...(await this.supplierStats(user.companyId)) };
    }
    return this.forAdmin(user.companyId);
  }

  private async forCustomer(companyId: string) {
    const totals = await this.dashboard.orderTotals({ customerCompanyId: companyId });
    const accepted = this.of(totals, OrderStatus.Accepted);
    const completed = this.of(totals, OrderStatus.Completed);
    const open: ProjectFilter = { companyId, statuses: OPEN_PROJECT_STATUSES };
    // Only events that are not over. "Yesterday in UTC" is today somewhere, so it stays in.
    const notOver = new Date(this.clock.now() - DAY_MS).toISOString().slice(0, 10);
    const upcoming = await this.projects.list(
      { ...open, sort: ProjectSort.Soonest, endsOnOrAfter: notOver },
      FIRST_ROWS,
    );
    return {
      role: Role.Customer,
      projectsInProgress: await this.projects.count(open),
      projectsDraft: await this.countProjects(ProjectStatus.Draft, companyId),
      projectsWaiting: await this.countProjects(ProjectStatus.Waiting, companyId),
      projectsConfirmed: await this.countProjects(ProjectStatus.Confirmed, companyId),
      ordersWaiting: this.of(totals, OrderStatus.Pending).count,
      ordersConfirmed: accepted.count + completed.count,
      totalSpendCents: accepted.totalCents + completed.totalCents,
      upcomingProjects: this.projectRows(upcoming.rows),
      recentOrders: await this.orderRows({ customerCompanyId: companyId }),
    };
  }

  /** What a company sees of the orders for its own items. Also used for the admin company. */
  private async supplierStats(companyId: string) {
    const totals = await this.dashboard.orderTotals({ supplierCompanyId: companyId });
    const accepted = this.of(totals, OrderStatus.Accepted);
    return {
      ordersWaiting: this.of(totals, OrderStatus.Pending).count,
      ordersAccepted: accepted.count,
      revenueCents: accepted.totalCents + this.of(totals, OrderStatus.Completed).totalCents,
      itemsListed: await this.dashboard.countListedItems(companyId),
      itemsHidden: await this.dashboard.countHiddenItems(companyId),
      ordersToAnswer: await this.orderRows({
        supplierCompanyId: companyId,
        status: OrderStatus.Pending,
      }),
      ordersPerMonth: await this.ordersPerMonth(companyId),
      topItems: await this.dashboard.topItems(companyId, DASHBOARD_LIST_SIZE),
    };
  }

  private async forAdmin(companyId: string) {
    const everyCompany: OrderSide = {};
    const totals = await this.dashboard.orderTotals(everyCompany);
    const companies = await this.dashboard.companyCounts();
    const recent = await this.projects.list({ sort: ProjectSort.Newest }, FIRST_ROWS);
    const newest = [];
    for (const row of await this.dashboard.newestCompanies(DASHBOARD_LIST_SIZE)) {
      newest.push({
        id: row.company.id,
        name: row.company.name,
        type: row.company.type,
        ownerName: row.ownerName,
        createdAt: row.company.createdAt,
      });
    }
    return {
      role: Role.Admin,
      customers: companies.get(Role.Customer) ?? 0,
      customersDisabled: await this.dashboard.countDisabledCustomers(),
      suppliers: companies.get(Role.Supplier) ?? 0,
      suppliersWaiting: await this.dashboard.countSuppliersWaiting(),
      projects: recent.total,
      projectsWaiting: await this.countProjects(ProjectStatus.Waiting),
      ordersWaiting: this.of(totals, OrderStatus.Pending).count,
      orderValueCents:
        this.of(totals, OrderStatus.Accepted).totalCents +
        this.of(totals, OrderStatus.Completed).totalCents,
      recentProjects: this.projectRows(recent.rows),
      recentOrders: await this.orderRows(everyCompany),
      newestCompanies: newest,
      asSupplier: await this.supplierStats(companyId),
    };
  }

  /** The projects in one status, of one company or of all. */
  private countProjects(status: ProjectStatus, companyId?: string): Promise<number> {
    return this.projects.count({ companyId, statuses: [status] });
  }

  private of(totals: Map<OrderStatus, OrderTotals>, status: OrderStatus): OrderTotals {
    return totals.get(status) ?? NOTHING;
  }

  /** The last months, the oldest first. A month with no orders has count 0. */
  private async ordersPerMonth(companyId: string) {
    const now = new Date(this.clock.now());
    const months: string[] = [];
    for (let back = DASHBOARD_MONTHS - 1; back >= 0; back--) {
      // The months are in UTC, like `created_at`. `Date.UTC` handles a month below 0.
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      months.push(first.toISOString().slice(0, 7));
    }
    const counts = await this.dashboard.ordersPerMonth(companyId, months[0] as string);
    const result = [];
    for (const month of months) {
      result.push({ month, count: counts.get(month) ?? 0 });
    }
    return result;
  }

  /** The newest orders that match. Every role gets the same fields of an order. */
  private async orderRows(filter: OrderFilter) {
    const rows = [];
    for (const order of await this.orders.list(filter, undefined, FIRST_ROWS)) {
      rows.push(this.orderRow(order));
    }
    return rows;
  }

  private orderRow(order: Order) {
    return {
      id: order.id,
      number: order.number,
      projectId: order.projectId,
      customerCompanyName: order.customerCompanyName,
      supplierCompanyName: order.supplierCompanyName,
      projectName: order.event.name,
      startsOn: order.event.startsOn,
      endsOn: order.event.endsOn,
      totalCents: order.totalCents,
      status: order.status,
      createdAt: order.createdAt,
    };
  }

  private projectRows(projects: Project[]) {
    const rows = [];
    for (const project of projects) {
      rows.push({
        id: project.id,
        name: project.name,
        companyName: project.companyName,
        venue: project.venue,
        city: project.city,
        startsOn: project.startsOn,
        endsOn: project.endsOn,
        status: project.status,
        createdAt: project.createdAt,
      });
    }
    return rows;
  }
}
