import { flashLater } from "./flash";

/**
 * Who is logged in, as one JSON record in localStorage. Every tab of the browser reads the
 * same record, so all tabs always agree on who is logged in.
 */
const SESSION_KEY = "access_token";
/** The same key as in `chosen-project.ts`. A new login starts without the old choice. */
const CHOSEN_PROJECT_KEY = "catalog_project_id";

interface Session {
  /** The token that every request sends. */
  token: string;
  /**
   * Only while an admin acts as a customer: the own token of the admin. `token` is the
   * acting token then. This one is never sent with a request. "Stop" puts it back.
   */
  adminToken?: string;
}
/** Where an admin lands after "Stop". */
export const AFTER_ACTING_URL = "/admin/customers";
const API_PREFIX = "/api/v1";
/** The login page shows "Your session ended" for this URL. */
export const SESSION_ENDED_URL = "/login?reason=session";

export type Role = "admin" | "supplier" | "customer";

/** One part of a list, and the number of rows that match the search and the filters. */
export interface Page<T> {
  rows: T[];
  total: number;
  /**
   * More numbers of the whole list, from the `X-Counts` header: the rows per status for the
   * same search, `totalCents`, `hidden`, `waiting`. Empty when the list has none.
   */
  counts: Record<string, number>;
}

/**
 * What a list call asks for. The API gives at most 200 rows in one call. `q` is the search
 * text. Every other key is a filter of that list, like `status`. An empty value is left out.
 */
export interface PageQuery {
  limit?: number;
  offset?: number;
  q?: string;
  [filter: string]: string | number | boolean | undefined;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, "admin">;
  companyName: string;
}

export interface User {
  id: string;
  companyId: string;
  companyName: string;
  role: Role;
  isOwner: boolean;
  /** False while a supplier that signed up by itself waits for an admin. */
  companyApproved: boolean;
  name: string;
  email: string;
  /** Set when a platform admin acts as this user in this session. */
  actingAdmin: { id: string; name: string } | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  type: Role;
  contactEmail: string | null;
  disabledAt: string | null;
  /** `null` while a supplier waits for approval. */
  approvedAt: string | null;
  /** Its organization group. Only a customer can have one. */
  organizationId: string | null;
  organizationName: string | null;
  /** Its orders, as supplier or as customer, that wait. Disabling the company cancels them. */
  pendingOrderCount: number;
  /** Its accepted orders. Disabling the company leaves them as they are. */
  acceptedOrderCount: number;
  createdAt: string;
}

/** An organization group. Its customer companies share their items for free. */
export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  companies: { id: string; name: string; contactEmail: string | null; itemCount: number }[];
}

/** A message inside the app. `link` is the page it is about. */
export interface Notification {
  id: string;
  text: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

/** One thing an admin did while acting as a customer. */
export interface AdminAction {
  id: string;
  adminName: string;
  companyName: string;
  /** `impersonate` for the start, then the method and the path of each change. */
  action: string;
  createdAt: string;
}

export interface NotificationPage extends Page<Notification> {
  unread: number;
}

/** What the users of a company see of their own company. "" means not set. */
export interface CompanyProfile {
  id: string;
  name: string;
  type: Role;
  phone: string;
  address: string;
  website: string;
  about: string;
  createdAt: string;
  /** My organization group with every company in it (also mine), or `null`. */
  organization: { id: string; name: string; companies: { id: string; name: string }[] } | null;
}

export type CompanyProfileInput = Pick<
  CompanyProfile,
  "name" | "phone" | "address" | "website" | "about"
>;

export type ItemUnit = "piece" | "set" | "meter" | "sqm";

export interface ItemPhoto {
  id: string;
  url: string;
}

export interface Item {
  id: string;
  companyId: string;
  companyName: string;
  companyType: Role;
  name: string;
  category: string;
  description: string;
  priceCents: number;
  sku: string | null;
  unit: ItemUnit;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  weightKg: number | null;
  color: string | null;
  material: string | null;
  /** How many the company has in total. An order never lowers it. `null`: no limit. */
  stock: number | null;
  /**
   * How many are free. Asked with a project: on the dates of that project.
   * Else it is the stock. `null` means there is no limit.
   */
  available: number | null;
  /** Asked with a project: how many are in it already, in lines that are not sent. Else 0. */
  inProject: number;
  /** For the owner: the days from today on where accepted orders hold more than the stock. */
  overbooked: { from: string; to: string; booked: number }[];
  hiddenAt: string | null;
  /** In order. The first one is the cover. */
  photos: ItemPhoto[];
  /** The cover photo. */
  photoUrl: string | null;
  createdAt: string;
}

/** One row of "My items". */
export interface MyItem extends Item {
  /** How many orders hold this item. */
  orderCount: number;
}

/** One item with the public profile of its company. "" means not set. */
export interface ItemDetail extends Item {
  companyPhone: string;
  companyWebsite: string;
  companyAbout: string;
}

export interface ItemInput {
  name: string;
  category: string;
  description: string;
  priceCents: number;
  sku: string | null;
  unit: ItemUnit;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  weightKg: number | null;
  color: string | null;
  material: string | null;
  stock: number | null;
  hidden: boolean;
}

export type ProjectStatus = "draft" | "waiting" | "confirmed" | "done" | "cancelled";
export type OrderStatus = "pending" | "accepted" | "rejected" | "cancelled" | "completed";

export interface Project {
  id: string;
  /** The customer company. */
  companyId: string;
  companyName: string;
  name: string;
  venue: string;
  city: string;
  hall: string;
  boothNumber: string;
  boothWidthCm: number | null;
  boothDepthCm: number | null;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
  setupOn: string | null;
  notes: string;
  status: ProjectStatus;
  /** True while an order waits or is accepted. The dates, the place and the booth are locked. */
  eventLocked: boolean;
  orderCount: number;
  pendingOrderCount: number;
  lineCount: number;
  /** The sum of the waiting, accepted and completed orders. */
  totalCents: number;
  cancelledAt: string | null;
  doneAt: string | null;
  createdBy: string | null;
  /** Set when a platform admin made it while acting as the customer. */
  createdByAdminName: string | null;
  createdAt: string;
}

export interface ProjectInput {
  name: string;
  venue: string;
  city: string;
  hall: string;
  boothNumber: string;
  boothWidthCm: number | null;
  boothDepthCm: number | null;
  startsOn: string;
  endsOn: string;
  setupOn: string | null;
  notes: string;
}

export interface ProjectLine {
  id: string;
  itemId: string;
  itemName: string;
  category: string;
  sku: string | null;
  photoUrl: string | null;
  unit: ItemUnit;
  /** The company that owns the item. */
  companyId: string;
  companyName: string;
  quantity: number;
  /** 0 for an own or a shared item. */
  unitPriceCents: number;
  lineTotalCents: number;
  stock: number | null;
  /** How many are free on the dates of the project. `null` means no limit. */
  available: number | null;
  /** False when the owner hid the item, or the owner company is off. It cannot be sent. */
  inCatalog: boolean;
  /** own: my item. shared: an item of a company in my group. Both are free and never sent. */
  state: "own" | "shared" | "not_sent" | "sent";
  orderId: string | null;
  orderStatus: OrderStatus | null;
}

export interface OrderLine {
  id: string;
  itemId: string;
  itemName: string;
  /** From the moment of sending. An old order has `null`. */
  category: string | null;
  sku: string | null;
  unit: ItemUnit;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  photoUrl: string | null;
  /** How many the owner has in total now. `null`: no limit. */
  stock: number | null;
  /**
   * On a waiting order, for the company that answers it: how many are free on the dates
   * of the order. `null`: no limit, or not worked out.
   */
  available: number | null;
}

export interface Order {
  id: string;
  /** Like "ORD-4F9A01BC". */
  number: string;
  projectId: string;
  projectName: string;
  /** The place of the event. "" means not set. */
  venue: string;
  city: string;
  customerCompanyId: string;
  customerCompanyName: string;
  supplierCompanyId: string;
  supplierCompanyName: string;
  status: OrderStatus;
  /** The note of the customer. */
  note: string;
  rejectReason: string | null;
  /** Who cancelled it. `null` when it is not cancelled. */
  cancelledBy: "customer" | "supplier" | "admin" | null;
  /** Set when a platform admin sent it while acting as the customer. */
  createdByAdminName: string | null;
  totalCents: number;
  lineCount: number;
  startsOn: string;
  endsOn: string;
  decidedAt: string | null;
  decidedBy: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

/** The facts of the event that the supplier sees. */
export type OrderProject = Pick<
  Project,
  | "id"
  | "name"
  | "venue"
  | "city"
  | "hall"
  | "boothNumber"
  | "boothWidthCm"
  | "boothDepthCm"
  | "startsOn"
  | "endsOn"
  | "setupOn"
  | "notes"
>;

export interface OrderDetail extends OrderWithLines {
  project: OrderProject;
  /** The owner of each company, and the phone of the company ("" means not set). */
  customerContactEmail: string | null;
  customerContactName: string | null;
  customerPhone: string;
  supplierContactEmail: string | null;
  supplierContactName: string | null;
  supplierPhone: string;
}

export interface ProjectDetail {
  project: Project;
  lines: ProjectLine[];
  orders: OrderWithLines[];
}

/** The answer of "Add these items again". */
export interface AddAgainResult extends ProjectDetail {
  /** One plain sentence per item that could not be added. */
  notAdded: string[];
}

export interface DashboardOrder {
  id: string;
  number: string;
  projectId: string;
  customerCompanyName: string;
  supplierCompanyName: string;
  projectName: string;
  startsOn: string;
  endsOn: string;
  totalCents: number;
  status: OrderStatus;
  createdAt: string;
}

export interface DashboardProject {
  id: string;
  name: string;
  companyName: string;
  venue: string;
  city: string;
  startsOn: string;
  endsOn: string;
  status: ProjectStatus;
  createdAt: string;
}

/** What a company sees of the orders for its own items. */
export interface SupplierStats {
  ordersWaiting: number;
  ordersAccepted: number;
  revenueCents: number;
  itemsListed: number;
  itemsHidden: number;
  ordersToAnswer: DashboardOrder[];
  /** 6 months, the oldest first. `month` is like "2026-10". */
  ordersPerMonth: { month: string; count: number }[];
  topItems: {
    itemId: string;
    itemName: string;
    category: string;
    photoUrl: string | null;
    orderCount: number;
    quantity: number;
    revenueCents: number;
  }[];
}

export interface CustomerDashboard {
  role: "customer";
  projectsInProgress: number;
  projectsDraft: number;
  projectsWaiting: number;
  projectsConfirmed: number;
  ordersWaiting: number;
  ordersConfirmed: number;
  totalSpendCents: number;
  upcomingProjects: DashboardProject[];
  recentOrders: DashboardOrder[];
}

export interface SupplierDashboard extends SupplierStats {
  role: "supplier";
}

export interface AdminDashboard {
  role: "admin";
  customers: number;
  customersDisabled: number;
  suppliers: number;
  suppliersWaiting: number;
  projects: number;
  projectsWaiting: number;
  ordersWaiting: number;
  orderValueCents: number;
  recentProjects: DashboardProject[];
  recentOrders: DashboardOrder[];
  newestCompanies: {
    id: string;
    name: string;
    type: Role;
    ownerName: string | null;
    createdAt: string;
  }[];
  /** The orders for the items of the admin company. */
  asSupplier: SupplierStats;
}

export type Dashboard = CustomerDashboard | SupplierDashboard | AdminDashboard;

export interface Auth {
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The `code` of the API error, like `prices_changed`. Empty when there is none. */
    readonly code = "",
    /** The wrong fields of a 422: `path` is the name of the field in the request. */
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** All data goes through the JSON API. The Bearer token is kept in localStorage. */
export class ApiClient {
  /** The browser can block localStorage (private window). Then nobody is logged in. */
  private session(): Session | null {
    try {
      return parseSession(localStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  /** Throws when the browser blocks the storage. */
  private saveSession(session: Session): void {
    // What the last account chose (the project of the catalog) is not for the next one.
    localStorage.removeItem(CHOSEN_PROJECT_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  /** The token that the requests send. */
  getToken(): string | null {
    return this.session()?.token ?? null;
  }

  /** Nobody is logged in after this, in every tab. */
  private forgetSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(CHOSEN_PROJECT_KEY);
    } catch {
      // Nothing to forget.
    }
  }

  /**
   * An admin starts to work as a customer company. From now on every request of this
   * browser uses the acting token. The own token of the admin is only kept, never sent.
   */
  async actAs(companyId: string): Promise<Auth> {
    const mine = this.getToken();
    const auth = await this.request<Auth>("POST", `/companies/${companyId}/impersonate`);
    try {
      this.saveSession({ token: auth.token, adminToken: mine ?? undefined });
    } catch {
      throw new ApiError(0, "This browser blocks the storage of the page. Allow it to do this.");
    }
    return auth;
  }

  /**
   * Ends the acting session on the server and goes back to the own session of the admin.
   * Never throws: an acting token that is dead already is ended too.
   * False when nobody acts in this browser any more (another tab stopped it, or somebody
   * else logged in). Then nothing is changed: the page must load again.
   */
  async stopActing(): Promise<boolean> {
    const session = this.session();
    if (!session?.adminToken) {
      return false;
    }
    await this.end(session.token, "/auth/stop-impersonating");
    return this.backToAdmin(session);
  }

  /**
   * Puts the kept token of the admin back, but only when `session` is still the one in
   * use. Another tab can change it at any moment. False when it was not put back.
   */
  private backToAdmin(session: Session): boolean {
    if (!session.adminToken || this.getToken() !== session.token) {
      return false;
    }
    try {
      this.saveSession({ token: session.adminToken });
      return true;
    } catch {
      return false;
    }
  }

  /** Tells the server to end a token. A failure changes nothing for this browser. */
  private async end(token: string, path: string): Promise<void> {
    try {
      await fetch(API_PREFIX + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // The server cannot be reached. This browser forgets the token anyway.
    }
  }

  async register(input: RegisterInput): Promise<Auth> {
    return this.saveToken(await this.request<Auth>("POST", "/auth/register", input));
  }

  async login(input: { email: string; password: string }): Promise<Auth> {
    return this.saveToken(await this.request<Auth>("POST", "/auth/login", input));
  }

  /**
   * Never throws. A token that is already dead is logged out too.
   * An admin who acts as a customer logs out of both sessions, from any tab: the acting
   * session ends, and the own session of the admin ends too.
   */
  async logout(): Promise<void> {
    const session = this.session();
    this.forgetSession();
    for (const token of [session?.token, session?.adminToken]) {
      if (token) {
        await this.end(token, "/auth/logout");
      }
    }
  }

  /** Ends every session of this user, also this one. */
  async logoutAll(): Promise<void> {
    try {
      await this.request<void>("POST", "/auth/logout-all");
    } finally {
      this.forgetSession();
    }
  }

  me(): Promise<User> {
    return this.request<User>("GET", "/users/me");
  }

  updateMe(name: string): Promise<User> {
    return this.request<User>("PATCH", "/users/me", { name });
  }

  changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.request<void>("POST", "/users/me/password", { currentPassword, newPassword });
  }

  /** The owner sets it for a teammate. An admin sets it for a user of another company. */
  setUserPassword(id: string, newPassword: string): Promise<void> {
    return this.request<void>("POST", `/users/${id}/password`, { newPassword });
  }

  getDashboard(): Promise<Dashboard> {
    return this.request<Dashboard>("GET", "/dashboard");
  }

  getMyCompany(): Promise<CompanyProfile> {
    return this.request<CompanyProfile>("GET", "/company");
  }

  /** Only the owner can do this. */
  updateMyCompany(input: CompanyProfileInput): Promise<CompanyProfile> {
    return this.request<CompanyProfile>("PATCH", "/company", input);
  }

  /** `counts.waiting`: how many of them wait for approval. */
  listCompanies(type: RegisterInput["role"], query: PageQuery = {}): Promise<Page<Company>> {
    return this.list<Company>("/companies", { ...query, type });
  }

  getCompany(id: string): Promise<Company> {
    return this.request<Company>("GET", `/companies/${id}`);
  }

  createCompany(input: RegisterInput): Promise<Company> {
    return this.request<Company>("POST", "/companies", input);
  }

  updateCompany(id: string, change: { name?: string; disabled?: boolean }): Promise<Company> {
    return this.request<Company>("PATCH", `/companies/${id}`, change);
  }

  /** Lets a supplier that signed up by itself into the catalog. */
  approveCompany(id: string): Promise<Company> {
    return this.request<Company>("POST", `/companies/${id}/approve`);
  }

  /** The customer companies that are in no group yet. */
  listUngroupedCustomers(query: PageQuery = {}): Promise<Page<Company>> {
    return this.list<Company>("/companies", { ...query, type: "customer", ungrouped: true });
  }

  /** Every group that matches. The list has no paging: a platform has a handful of groups. */
  async listOrganizations(q = ""): Promise<Organization[]> {
    return (await this.list<Organization>("/organizations", { q })).rows;
  }

  getOrganization(id: string): Promise<Organization> {
    return this.request<Organization>("GET", `/organizations/${id}`);
  }

  createOrganization(name: string): Promise<Organization> {
    return this.request<Organization>("POST", "/organizations", { name });
  }

  renameOrganization(id: string, name: string): Promise<Organization> {
    return this.request<Organization>("PATCH", `/organizations/${id}`, { name });
  }

  /** The companies stay. They only leave the group. */
  deleteOrganization(id: string): Promise<void> {
    return this.request<void>("DELETE", `/organizations/${id}`);
  }

  addOrganizationCompany(id: string, companyId: string): Promise<Organization> {
    return this.request<Organization>("PUT", `/organizations/${id}/companies/${companyId}`);
  }

  removeOrganizationCompany(id: string, companyId: string): Promise<Organization> {
    return this.request<Organization>("DELETE", `/organizations/${id}/companies/${companyId}`);
  }

  /** What admins did while they acted as a customer, the newest first. Admin only. */
  listAdminActions(query: PageQuery = {}): Promise<Page<AdminAction>> {
    return this.list<AdminAction>("/admin-actions", query);
  }

  /** My notifications, the newest first, and how many are new. */
  async listNotifications(query: PageQuery = {}): Promise<NotificationPage> {
    const response = await this.send("GET", `/notifications${this.queryText(query)}`);
    const rows: Notification[] = await response.json();
    return {
      rows,
      total: Number(response.headers.get("X-Total-Count")) || rows.length,
      counts: {},
      unread: Number(response.headers.get("X-Unread-Count")) || 0,
    };
  }

  readNotification(id: string): Promise<Notification> {
    return this.request<Notification>("POST", `/notifications/${id}/read`);
  }

  readAllNotifications(): Promise<void> {
    return this.request<void>("POST", "/notifications/read");
  }

  /** Filter: `category`. `counts.hidden`: how many of the items that match are hidden. */
  listMyItems(query: PageQuery = {}): Promise<Page<MyItem>> {
    return this.list<MyItem>("/items/mine", query);
  }

  /** The categories of my items, or of my catalog, sorted. */
  listCategories(scope: "mine" | "catalog"): Promise<string[]> {
    return this.request<string[]>("GET", `/items/categories?scope=${scope}`);
  }

  /** With a project, `available` is for the dates of that project. */
  getItem(id: string, projectId = ""): Promise<ItemDetail> {
    const query = projectId ? `?projectId=${projectId}` : "";
    return this.request<ItemDetail>("GET", `/items/${id}${query}`);
  }

  createItem(input: ItemInput): Promise<Item> {
    return this.request<Item>("POST", "/items", input);
  }

  updateItem(id: string, change: Partial<ItemInput>): Promise<Item> {
    return this.request<Item>("PATCH", `/items/${id}`, change);
  }

  /** Adds one photo at the end. The first photo of an item is its cover. */
  addItemPhoto(id: string, photo: File): Promise<Item> {
    const form = new FormData();
    form.append("photo", photo);
    return this.request<Item>("POST", `/items/${id}/photos`, form);
  }

  removeItemPhoto(id: string, photoId: string): Promise<Item> {
    return this.request<Item>("DELETE", `/items/${id}/photos/${photoId}`);
  }

  setItemCover(id: string, photoId: string): Promise<Item> {
    return this.request<Item>("PUT", `/items/${id}/photos/${photoId}/cover`);
  }

  /**
   * The items a customer can add to a project: of approved suppliers, of the admin company,
   * their own, and the items that the companies of their organization group share.
   */
  /**
   * Filters: `category`, `owner` (supplier, shared, own) and `projectId`. With a project,
   * `available` and `inProject` of each item are for that project.
   */
  listCatalog(query: PageQuery = {}): Promise<Page<Item>> {
    return this.list<Item>("/items/catalog", query);
  }

  /**
   * A customer gets their own projects. An admin gets all. Filters: `status`, `open`
   * (not done, not cancelled) and `hasWaitingOrders`. `counts` has the projects per status
   * and `totalCents`, the sum of the order totals of the projects that match.
   */
  listProjects(query: PageQuery = {}): Promise<Page<Project>> {
    return this.list<Project>("/projects", query);
  }

  getProject(id: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("GET", `/projects/${id}`);
  }

  createProject(input: ProjectInput): Promise<Project> {
    return this.request<Project>("POST", "/projects", input);
  }

  updateProject(id: string, input: ProjectInput): Promise<Project> {
    return this.request<Project>("PATCH", `/projects/${id}`, input);
  }

  addProjectLine(id: string, itemId: string, quantity: number): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("POST", `/projects/${id}/lines`, { itemId, quantity });
  }

  updateProjectLine(id: string, lineId: string, quantity: number): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("PATCH", `/projects/${id}/lines/${lineId}`, { quantity });
  }

  removeProjectLine(id: string, lineId: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("DELETE", `/projects/${id}/lines/${lineId}`);
  }

  /**
   * Makes one order per supplier from the lines that are not sent yet.
   * `expectedTotalCents` is the total the page showed. When a price changed since then,
   * the API answers 409 `prices_changed` and sends nothing.
   */
  sendProject(id: string, note: string, expectedTotalCents: number): Promise<ProjectDetail> {
    const body = note ? { note, expectedTotalCents } : { expectedTotalCents };
    return this.request<ProjectDetail>("POST", `/projects/${id}/send`, body);
  }

  cancelProject(id: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("POST", `/projects/${id}/cancel`);
  }

  finishProject(id: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("POST", `/projects/${id}/done`);
  }

  /** Puts the items of a rejected or cancelled order back as lines that are not sent. */
  addOrderItemsAgain(id: string, orderId: string): Promise<AddAgainResult> {
    return this.request<AddAgainResult>("POST", `/projects/${id}/orders/${orderId}/add-again`);
  }

  /**
   * Customer: the orders of my projects. Supplier and admin: the orders for my company.
   * Filter: `status`. `counts` has the orders per status and `totalCents`, the sum of the
   * waiting, accepted and completed orders that match.
   */
  listOrders(query: PageQuery = {}): Promise<Page<Order>> {
    return this.list<Order>("/orders", query);
  }

  getOrder(id: string): Promise<OrderDetail> {
    return this.request<OrderDetail>("GET", `/orders/${id}`);
  }

  /** `cancel` is for the customer, while the order still waits. */
  changeOrder(id: string, action: "accept" | "complete" | "cancel"): Promise<OrderDetail> {
    return this.request<OrderDetail>("POST", `/orders/${id}/${action}`);
  }

  /**
   * The supplier cancels an order they already accepted. An admin cancels a waiting or
   * accepted order of any company. The reason is required.
   */
  cancelAcceptedOrder(id: string, reason: string): Promise<OrderDetail> {
    return this.request<OrderDetail>("POST", `/orders/${id}/cancel`, { reason });
  }

  rejectOrder(id: string, reason: string): Promise<OrderDetail> {
    return this.request<OrderDetail>("POST", `/orders/${id}/reject`, { reason });
  }

  listUsers(companyId?: string, query: PageQuery = {}): Promise<Page<User>> {
    return this.list<User>("/users", { ...query, companyId });
  }

  createUser(input: {
    name: string;
    email: string;
    password: string;
    companyId?: string;
  }): Promise<User> {
    return this.request<User>("POST", "/users", input);
  }

  removeUser(id: string): Promise<void> {
    return this.request<void>("DELETE", `/users/${id}`);
  }

  private saveToken(auth: Auth): Auth {
    // A new login starts clean: no old admin session waits behind it.
    try {
      this.saveSession({ token: auth.token });
    } catch {
      throw new ApiError(0, "This browser blocks the storage of the page. Allow it to log in.");
    }
    return auth;
  }

  /**
   * One part of a list. The search and the filters run on the server, so the answer is
   * right for a list of any size. `X-Total-Count` has the number of rows that match.
   */
  private async list<T>(path: string, query: PageQuery = {}): Promise<Page<T>> {
    const response = await this.send("GET", path + this.queryText(query));
    const rows: T[] = await response.json();
    const header = response.headers.get("X-Total-Count");
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(response.headers.get("X-Counts") ?? "{}");
    } catch {
      // No counts this time.
    }
    return { rows, total: header === null ? rows.length : Number(header), counts };
  }

  /** `?q=…&status=…`. A key with no value, an empty text or `false` is left out. */
  private queryText(query: PageQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const text = typeof value === "string" ? value.trim() : value;
      if (text !== undefined && text !== "" && text !== false) {
        params.set(key, String(text));
      }
    }
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    return response.status === 204 ? (undefined as T) : response.json();
  }

  /** Sends one call. Throws an `ApiError` when the answer is not a success. */
  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    // A form (file upload) is sent as it is. The browser sets its content type.
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetch(API_PREFIX + path, { method, headers, body: payload });
    } catch {
      // No network, or the server is down. The browser gives a technical text for this.
      throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
    }
    if (response.ok) {
      return response;
    }
    // A token that stopped working: the user was removed, the company was disabled or
    // the token is too old. The login page says so.
    // A wrong password on the login page is a 401 too. That one stays on the page.
    if (response.status === 401 && token && path !== "/auth/login") {
      this.tokenDied(token);
    }
    const seconds = Number(response.headers.get("Retry-After"));
    if (response.status === 429 && seconds > 0) {
      throw new ApiError(429, `Too many attempts. Wait ${waitText(seconds)} and try again.`);
    }
    let data: ErrorBody = {};
    try {
      data = await response.json();
    } catch {
      // The answer is not JSON, for example when a proxy is down.
    }
    throw new ApiError(
      response.status,
      this.errorMessage(data),
      data.error?.code ?? "",
      data.error?.details ?? [],
    );
  }

  /**
   * The server refused `token`. The browser never moves to another token because of this,
   * with one exception: the dead token is the acting token of the session in use. Then
   * the acting session ended (2 hours passed, or the company was disabled) and the admin
   * goes back to the own session. In every other case nobody is logged in after this.
   */
  private tokenDied(token: string): void {
    const session = this.session();
    if (session && session.token !== token) {
      // The stored login is not the dead one. Either an earlier 401 of this page already
      // handled it and the page is on its way, or another tab logged in as somebody else
      // and the `storage` event loads this page again. Nothing to do here.
      return;
    }
    if (session && this.backToAdmin(session)) {
      flashLater("You stopped acting as the customer.");
      window.location.assign(AFTER_ACTING_URL);
      return;
    }
    this.forgetSession();
    // After the new login the user comes back to this page.
    const here = window.location.pathname + window.location.search;
    window.location.assign(`${SESSION_ENDED_URL}&next=${encodeURIComponent(here)}`);
  }

  /**
   * For the `storage` event of the window. It fires when ANOTHER tab changed the storage.
   * When the logged-in user changed there (log in, log out, act as, stop), this tab shows
   * pages of the old user. It loads again, at the home page of who is logged in now.
   */
  otherTabChanged(event: { key: string | null; oldValue: string | null }): void {
    // The key is `null` when the whole storage was cleared.
    if (event.key !== null && event.key !== SESSION_KEY) {
      return;
    }
    const now = this.getToken();
    if (event.key === null || (parseSession(event.oldValue)?.token ?? null) !== now) {
      window.location.assign(now ? "/dashboard" : "/login");
    }
  }

  /** Every detail of a validation error is a plain sentence with the label of its field. */
  private errorMessage(data: ErrorBody): string {
    const details = data.error?.details;
    if (details && details.length > 0) {
      const lines = [];
      for (const detail of details) {
        lines.push(detail.message);
      }
      return lines.join("\n");
    }
    return data.error?.message ?? "Something went wrong.";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
}

/** Reads a stored session value. `null` when nobody is logged in or the value is broken. */
function parseSession(raw: string | null): Session | null {
  if (!raw) {
    return null;
  }
  try {
    // A login from before the record was JSON: the value is the token itself.
    const session: Session = raw.startsWith("{") ? JSON.parse(raw) : { token: raw };
    return typeof session.token === "string" && session.token ? session : null;
  } catch {
    return null;
  }
}

/** Like "45 seconds" or "12 minutes". */
function waitText(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export const api = new ApiClient();
