import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ApiClient } from "../resources/js/api";
import { API, World } from "./support/world";

/**
 * The browser side of "act as a customer" (review 3, M1 and L3). It runs the real
 * `ApiClient` against the real app. Two tabs of one browser share one localStorage, and
 * each tab has its own sessionStorage (only the flash message lives there).
 */
class FakeStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }
}

const KEY = "access_token";
const PASSWORD = "a-long-password";
const g = globalThis as Record<string, unknown>;
const before = { ...g };
const api = new ApiClient();
let local: FakeStorage;
let tab: FakeStorage;
let visited: string[];
let world: World;
let admin: string;

function stored(): { token?: string; adminToken?: string } {
  return JSON.parse(local.getItem(KEY) ?? "{}");
}

async function roleOf(token: string): Promise<string | number> {
  const response = await world.get("/users/me", token);
  return response.status === 200 ? (await response.json()).role : response.status;
}

beforeAll(async () => {
  world = await World.create();
  admin = "root@tabs.example";
  await world.context.authService.registerAdmin({ name: "Root", email: admin, password: PASSWORD });
  g.confirm = () => true;
  g.fetch = (url: string, init?: RequestInit) => world.context.app.request(url, init);
});

beforeEach(() => {
  local = new FakeStorage();
  tab = new FakeStorage();
  visited = [];
  g.localStorage = local;
  g.sessionStorage = tab;
  g.window = {
    location: { assign: (url: string) => visited.push(url), pathname: "/projects", search: "" },
  };
});

afterAll(async () => {
  for (const name of ["confirm", "fetch", "localStorage", "sessionStorage", "window"]) {
    g[name] = before[name];
  }
  await world.close();
});

describe("the tokens in the browser", () => {
  test("log out in another tab ends both sessions, and a later 401 never brings the admin back", async () => {
    const acme = await world.customer("Acme Buyer");
    const other = await world.customer("Other Buyer");

    // Tab A: the admin logs in and starts to act as Acme. Both tokens are in one record.
    await api.login({ email: admin, password: PASSWORD });
    const adminToken = stored().token as string;
    await api.actAs(acme.user.companyId);
    const actingToken = stored().token as string;
    expect(stored()).toEqual({ token: actingToken, adminToken });
    expect((await api.me()).actingAdmin?.name).toBe("Root");

    // Tab B (the same localStorage): "Log out". Both sessions end on the server.
    await api.logout();
    expect(local.getItem(KEY)).toBeNull();
    expect(await roleOf(actingToken)).toBe(401);
    expect(await roleOf(adminToken)).toBe(401);

    // Tab B: a customer logs in on this browser.
    await api.login({ email: world.email("Other Buyer"), password: PASSWORD });
    expect(stored().adminToken).toBeUndefined();
    // That token dies for a normal reason: "log out everywhere" on another device.
    await world.client.send("POST", `${API}/auth/logout-all`, other.token);

    // Tab A is still open. Its next request gets a 401: nobody is logged in after it.
    await api.me().catch(() => undefined);
    expect(local.getItem(KEY)).toBeNull();
    expect(visited.at(-1)).toBe("/login?reason=session&next=%2Fprojects");
  });

  test("the acting token dies: the admin is back in the own session", async () => {
    const buyer = await world.customer("Timed Buyer");
    await api.login({ email: admin, password: PASSWORD });
    const adminToken = stored().token as string;
    await api.actAs(buyer.user.companyId);
    // The 2 hours are over.
    await world.context
      .sql`UPDATE access_tokens SET expires_at = ${"2020-01-01T00:00:00.000Z"} WHERE impersonator_id IS NOT NULL`;

    await api.me().catch(() => undefined);
    expect(stored()).toEqual({ token: adminToken });
    expect(visited.at(-1)).toBe("/admin/customers");
    expect(tab.getItem("flash_message")).toBe("You stopped acting as the customer.");
    // A page sends more than one request. A second 401 for the same dead token changes nothing.
    const sent = g.fetch;
    g.fetch = () => Promise.resolve(new Response("{}", { status: 401 }));
    local.setItem(KEY, JSON.stringify({ token: "acting", adminToken }));
    const first = api.me().catch(() => undefined);
    const second = api.me().catch(() => undefined);
    await Promise.all([first, second]);
    g.fetch = sent;
    expect(stored()).toEqual({ token: adminToken });
    expect(visited).toEqual(["/admin/customers", "/admin/customers"]);
    expect((await api.me()).role).toBe("admin");
    await api.logout();
  });

  test("the admin token is dead too: nobody is logged in", async () => {
    const buyer = await world.customer("Gone Buyer");
    await api.login({ email: admin, password: PASSWORD });
    await api.actAs(buyer.user.companyId);
    // Every token of the admin ends. The acting token ends with them.
    await world.context.sql`DELETE FROM access_tokens`;

    await api.me().catch(() => undefined);
    // First back to the admin token, as the acting token was the dead one ...
    expect(visited.at(-1)).toBe("/admin/customers");
    // ... and the first request with it ends the session for good.
    await api.me().catch(() => undefined);
    expect(local.getItem(KEY)).toBeNull();
    expect(visited.at(-1)).toStartWith("/login?reason=session");
  });

  test("Stop works in every tab, and it never replaces the login of somebody else", async () => {
    const buyer = await world.customer("Stop Buyer");
    await api.login({ email: admin, password: PASSWORD });
    const adminToken = stored().token as string;
    await api.actAs(buyer.user.companyId);
    const actingToken = stored().token as string;

    // A new tab has its own sessionStorage. "Stop" works there too.
    g.sessionStorage = new FakeStorage();
    expect(await api.stopActing()).toBe(true);
    expect(stored()).toEqual({ token: adminToken });
    expect(await roleOf(actingToken)).toBe(401);
    expect(await roleOf(adminToken)).toBe("admin");

    // An old tab still shows the "Stop" bar. Nobody acts any more: nothing changes.
    expect(await api.stopActing()).toBe(false);
    expect(stored()).toEqual({ token: adminToken });
    // The same when somebody else is logged in now.
    await api.logout();
    await api.login({ email: world.email("Stop Buyer"), password: PASSWORD });
    const customerToken = stored().token;
    expect(await api.stopActing()).toBe(false);
    expect(stored()).toEqual({ token: customerToken });
    expect(await roleOf(customerToken as string)).toBe("customer");
  });

  test("a 401 for an old token does not touch the login that another tab made", async () => {
    const first = await world.customer("First Buyer");
    await world.customer("Second Buyer");
    // The page sends a request with the token of the first user. While it is on its way,
    // that token ends and another tab logs in as the second user.
    const send = g.fetch as (url: string, init?: RequestInit) => Promise<Response>;
    local.setItem(KEY, JSON.stringify({ token: first.token }));
    g.fetch = async (url: string, init?: RequestInit) => {
      g.fetch = send;
      await world.client.send("POST", `${API}/auth/logout-all`, first.token);
      const answer = await send(url, init);
      await api.login({ email: world.email("Second Buyer"), password: PASSWORD });
      return answer;
    };
    await api.me().catch(() => undefined);
    expect((await api.me()).companyName).toBe("Second Buyer");
    // This request moves the page nowhere. The `storage` event of the new login does.
    expect(visited).toEqual([]);
  });

  test("another tab changed who is logged in: this tab loads again at the right home", async () => {
    local.setItem(KEY, JSON.stringify({ token: "new", adminToken: "kept" }));
    const old = JSON.stringify({ token: "old" });
    // Act as, stop, or a new login: the token in use is another one.
    api.otherTabChanged({ key: KEY, oldValue: old });
    expect(visited).toEqual(["/dashboard"]);
    // The same token as before (the record was only written again): nothing happens.
    api.otherTabChanged({ key: KEY, oldValue: JSON.stringify({ token: "new" }) });
    // Another key, like the chosen project or a flash message: nothing happens.
    api.otherTabChanged({ key: "catalog_project_id", oldValue: "x" });
    expect(visited).toEqual(["/dashboard"]);
    // Log out in another tab.
    local.removeItem(KEY);
    api.otherTabChanged({ key: KEY, oldValue: old });
    // The whole storage was cleared.
    api.otherTabChanged({ key: null, oldValue: null });
    expect(visited).toEqual(["/dashboard", "/login", "/login"]);
  });

  test("a login from before this change still works: the value is the token itself", async () => {
    const buyer = await world.customer("Old Login Buyer");
    local.setItem(KEY, buyer.token);
    expect(api.getToken()).toBe(buyer.token);
    expect((await api.me()).role).toBe("customer");
    await api.logout();
    expect(await roleOf(buyer.token)).toBe(401);
  });
});
