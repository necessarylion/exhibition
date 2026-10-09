import { expect } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./build-app";

export const API = "/api/v1";

export interface Account {
  token: string;
  user: { id: string; companyId: string; name: string };
}

/**
 * A test app with short helpers to make the things most tests need: an admin, companies,
 * items, projects and orders.
 */
export class World {
  private count = 0;

  private constructor(
    readonly context: TestApp,
    readonly client: Client,
  ) {}

  static async create(env: Record<string, string> = {}): Promise<World> {
    const context = await buildApp(env);
    return new World(context, new Client(context.app));
  }

  close(): Promise<void> {
    return this.context.sql.close();
  }

  /** A platform admin. Returns its token. */
  async admin(email = "root@world.example", name = "Root Admin"): Promise<string> {
    await this.context.authService.registerAdmin({ name, email, password: PASSWORD });
    return (await this.client.login(email)).token;
  }

  supplier(name: string, approve = true): Promise<Account> {
    return this.client.signUp("supplier", this.email(name), name, approve);
  }

  customer(name: string): Promise<Account> {
    return this.client.signUp("customer", this.email(name), name);
  }

  email(name: string): string {
    return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}@world.example`;
  }

  async item(token: string, extra: object = {}): Promise<string> {
    const body = { name: `Item ${++this.count}`, category: "Stand", priceCents: 1000, ...extra };
    const response = await this.client.send("POST", `${API}/items`, token, body);
    expect(response.status).toBe(201);
    return (await response.json()).id;
  }

  async project(token: string, startsOn = "2027-03-01", endsOn = "2027-03-03", extra: object = {}) {
    const body = { name: `Fair ${++this.count}`, startsOn, endsOn, ...extra };
    const response = await this.client.send("POST", `${API}/projects`, token, body);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  addLine(token: string, projectId: string, itemId: string, quantity = 1) {
    const path = `${API}/projects/${projectId}/lines`;
    return this.client.send("POST", path, token, { itemId, quantity });
  }

  /** A new project with one line, sent. Returns the ids of the project and of its order. */
  async order(
    customer: string,
    itemId: string,
    quantity = 1,
    startsOn = "2027-03-01",
    endsOn = "2027-03-03",
  ) {
    const projectId = await this.project(customer, startsOn, endsOn);
    expect((await this.addLine(customer, projectId, itemId, quantity)).status).toBe(201);
    const sent = await this.client.sendProject(projectId, customer);
    expect(sent.status).toBe(200);
    return { projectId, orderId: (await sent.json()).orders[0].id as string };
  }

  /** `action` is accept, reject, cancel or complete. */
  act(token: string, orderId: string, action: string, body?: object) {
    return this.client.send("POST", `${API}/orders/${orderId}/${action}`, token, body);
  }

  get(path: string, token: string) {
    return this.client.send("GET", `${API}${path}`, token);
  }

  json(path: string, token: string) {
    return this.client.json(`${API}${path}`, token);
  }

  /** The texts of the notifications of a user, the newest first. */
  async notes(token: string): Promise<string[]> {
    const texts: string[] = [];
    for (const row of await this.json("/notifications", token)) {
      texts.push(row.text);
    }
    return texts;
  }
}

/** How many answers had each status, like `{ 200: 3, 409: 5 }`. */
export function tally(responses: Response[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (const response of responses) {
    result[response.status] = (result[response.status] ?? 0) + 1;
  }
  return result;
}
