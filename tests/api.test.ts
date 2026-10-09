import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuthService } from "../app/services/auth.service";
import { buildApp, Client, type TestApp } from "./support/build-app";

// The whole app on an in-memory SQLite database, or on PostgreSQL with `TEST_DATABASE_URL`.
describe("API", () => {
  let context: TestApp;
  let app: TestApp["app"];
  let authService: AuthService;

  function post(path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  function send(method: string, path: string, token: string, body?: unknown) {
    return new Client(app).send(method, path, token, body);
  }

  async function login(email: string) {
    const response = await post("/api/v1/auth/login", { email, password: "a-long-password" });
    return { status: response.status, token: (await response.json()).token as string };
  }

  function me(token: string) {
    return app.request("/api/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
  }

  beforeAll(async () => {
    context = await buildApp();
    ({ app, authService } = context);
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("register, login, me, logout", async () => {
    const registered = await post("/api/v1/auth/register", {
      name: "Aung",
      email: "Aung@Example.com",
      password: "a-long-password",
      role: "supplier",
      companyName: "Aung Trading",
    });
    expect(registered.status).toBe(201);

    const login = await post("/api/v1/auth/login", {
      email: "aung@example.com",
      password: "a-long-password",
    });
    expect(login.status).toBe(200);
    const { token } = await login.json();

    const profile = await me(token);
    expect(profile.status).toBe(200);
    const user = await profile.json();
    expect(user.email).toBe("aung@example.com");
    expect(user.role).toBe("supplier");
    expect(user.companyName).toBe("Aung Trading");
    expect(user.passwordHash).toBeUndefined();

    expect((await post("/api/v1/auth/logout", {}, token)).status).toBe(204);
    expect((await me(token)).status).toBe(401);
  });

  test("invalid input gets 422 with details", async () => {
    const response = await post("/api/v1/auth/register", {
      name: "",
      email: "x",
      password: "1",
      role: "customer",
      companyName: "Aung Trading",
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.length).toBe(3);
  });

  test("nobody can sign up as an admin", async () => {
    const response = await post("/api/v1/auth/register", {
      name: "Eve",
      email: "eve@example.com",
      password: "a-long-password",
      role: "admin",
      companyName: "Eve Corp",
    });

    expect(response.status).toBe(422);
  });

  test("an admin creates, lists, renames and disables a company", async () => {
    const account = { name: "Root", email: "root@example.com", password: "a-long-password" };
    const adminUser = await authService.registerAdmin(account);
    const admin = (await login(account.email)).token;

    const created = await send("POST", "/api/v1/companies", admin, {
      name: "Mya",
      email: "mya@example.com",
      password: "a-long-password",
      role: "customer",
      companyName: "Mya Events",
    });
    expect(created.status).toBe(201);
    const company = await created.json();
    expect(company.contactEmail).toBe("mya@example.com");
    const mya = (await login("mya@example.com")).token;

    const list = await (await send("GET", "/api/v1/companies?type=customer", admin)).json();
    expect(list.map((row: { name: string }) => row.name)).toEqual(["Mya Events"]);

    const path = `/api/v1/companies/${company.id}`;
    const updated = await send("PATCH", path, admin, { name: "Mya Expo", disabled: true });
    expect((await updated.json()).name).toBe("Mya Expo");

    // Disabled: the old token stops working and a new login is refused.
    expect((await me(mya)).status).toBe(401);
    expect((await login("mya@example.com")).status).toBe(403);

    expect((await send("PATCH", path, admin, { disabled: false })).status).toBe(200);
    expect((await login("mya@example.com")).status).toBe(200);

    // The admin company itself cannot be changed here.
    const own = `/api/v1/companies/${adminUser.companyId}`;
    expect((await send("PATCH", own, admin, { disabled: true })).status).toBe(404);
  });

  test("only an admin can manage companies", async () => {
    await post("/api/v1/auth/register", {
      name: "Sup",
      email: "sup@example.com",
      password: "a-long-password",
      role: "supplier",
      companyName: "Sup Co",
    });
    const supplier = (await login("sup@example.com")).token;

    expect((await send("GET", "/api/v1/companies?type=customer", supplier)).status).toBe(403);
    expect((await app.request("/api/v1/companies?type=customer")).status).toBe(401);
  });

  describe("items", () => {
    let admin: string;
    let supplier: string;
    let customer: string;
    let otherCustomer: string;
    let supplierItemId: string;

    /** Signs up a company and returns the token of its user. */
    /** A supplier is approved at once here. `approval.test.ts` tests the waiting. */
    async function signUp(role: string, email: string, companyName: string) {
      return (await new Client(app).signUp(role, email, companyName)).token;
    }

    async function createItem(token: string, name: string, extra: object = {}) {
      const body = { name, category: "Furniture", priceCents: 1500, ...extra };
      const response = await send("POST", "/api/v1/items", token, body);
      expect(response.status).toBe(201);
      return (await response.json()) as { id: string; companyId: string };
    }

    async function names(path: string, token: string) {
      const items = await (await send("GET", path, token)).json();
      return items.map((item: { name: string }) => item.name);
    }

    beforeAll(async () => {
      const account = { name: "Ops", email: "ops@example.com", password: "a-long-password" };
      await authService.registerAdmin(account);
      admin = (await login(account.email)).token;
      supplier = await signUp("supplier", "chairs@example.com", "Chair Supply");
      customer = await signUp("customer", "expo@example.com", "Expo One");
      otherCustomer = await signUp("customer", "fair@example.com", "Fair Two");
      const gone = await signUp("supplier", "gone@example.com", "Gone Supply");

      await createItem(admin, "Admin carpet");
      supplierItemId = (await createItem(supplier, "Supplier chair")).id;
      await createItem(supplier, "Supplier hidden table", { hidden: true });
      await createItem(customer, "Customer own banner");
      await createItem(otherCustomer, "Other customer flag");
      const goneItem = await createItem(gone, "Gone supplier lamp");
      const path = `/api/v1/companies/${goneItem.companyId}`;
      expect((await send("PATCH", path, admin, { disabled: true })).status).toBe(200);
    });

    test("create an item and list mine, hidden ones too", async () => {
      const mine = await (await send("GET", "/api/v1/items/mine", supplier)).json();

      expect(mine.map((item: { name: string }) => item.name)).toEqual([
        "Supplier chair",
        "Supplier hidden table",
      ]);
      expect(mine[0]).toMatchObject({
        companyName: "Chair Supply",
        companyType: "supplier",
        category: "Furniture",
        description: "",
        priceCents: 1500,
        hiddenAt: null,
      });
      expect(mine[1].hiddenAt).not.toBeNull();
    });

    test("invalid item input gets 422", async () => {
      const body = { name: "", category: "Furniture", priceCents: -1 };

      expect((await send("POST", "/api/v1/items", supplier, body)).status).toBe(422);
      expect((await post("/api/v1/items", body)).status).toBe(401);
    });

    test("PATCH changes my item, and gives 404 for an item of another company", async () => {
      const path = `/api/v1/items/${supplierItemId}`;

      expect((await send("PATCH", path, customer, { name: "Stolen" })).status).toBe(404);
      // Also the admin can only change the items of the admin company.
      expect((await send("PATCH", path, admin, { name: "Stolen" })).status).toBe(404);
      const missing = `/api/v1/items/${crypto.randomUUID()}`;
      expect((await send("PATCH", missing, supplier, { name: "Nothing" })).status).toBe(404);

      const updated = await send("PATCH", path, supplier, { priceCents: 2000, hidden: true });
      expect(updated.status).toBe(200);
      const item = await updated.json();
      expect(item.name).toBe("Supplier chair");
      expect(item.priceCents).toBe(2000);
      expect(item.hiddenAt).not.toBeNull();

      const shown = await (await send("PATCH", path, supplier, { hidden: false })).json();
      expect(shown.hiddenAt).toBeNull();
    });

    test("the catalog has supplier, admin and my own items only", async () => {
      expect(await names("/api/v1/items/catalog", customer)).toEqual([
        "Admin carpet",
        "Customer own banner",
        "Supplier chair",
      ]);
      expect(await names("/api/v1/items/catalog", otherCustomer)).toEqual([
        "Admin carpet",
        "Other customer flag",
        "Supplier chair",
      ]);
    });

    test("only a customer can read the catalog", async () => {
      expect((await send("GET", "/api/v1/items/catalog", supplier)).status).toBe(403);
      expect((await send("GET", "/api/v1/items/catalog", admin)).status).toBe(403);
    });

    test("only an admin can list every item", async () => {
      expect((await send("GET", "/api/v1/items", supplier)).status).toBe(403);
      expect((await send("GET", "/api/v1/items", customer)).status).toBe(403);

      expect(await names("/api/v1/items", admin)).toEqual([
        "Admin carpet",
        "Customer own banner",
        "Gone supplier lamp",
        "Other customer flag",
        "Supplier chair",
        "Supplier hidden table",
      ]);
    });

    test("the extra fields are saved, changed and cleared with null", async () => {
      const extra = {
        sku: "BOOTH-33",
        unit: "sqm",
        widthCm: 300,
        heightCm: 250,
        depthCm: 300,
        weightKg: 12.345,
        color: "White",
        material: "Aluminium",
        stock: 4,
      };
      const created = await createItem(supplier, "Detailed booth", extra);
      const path = `/api/v1/items/${created.id}`;
      expect(created).toMatchObject(extra);
      expect(await (await send("GET", path, supplier)).json()).toMatchObject(extra);

      // A field that is not sent stays as it is.
      const changed = await send("PATCH", path, supplier, { unit: "set", weightKg: 0.5, stock: 0 });
      expect(await changed.json()).toMatchObject({
        ...extra,
        unit: "set",
        weightKg: 0.5,
        stock: 0,
      });

      const empty = {
        sku: null,
        widthCm: null,
        heightCm: null,
        depthCm: null,
        weightKg: null,
        color: null,
        material: null,
        stock: null,
      };
      expect((await send("PATCH", path, supplier, empty)).status).toBe(200);
      const cleared = await (await send("GET", path, supplier)).json();
      expect(cleared).toMatchObject({ ...empty, unit: "set", name: "Detailed booth" });

      // An item made without the extra fields has the defaults.
      const plain = await (await send("GET", `/api/v1/items/${supplierItemId}`, supplier)).json();
      expect(plain).toMatchObject({ ...empty, unit: "piece", photos: [], photoUrl: null });
    });

    test("wrong values in the extra fields get 422", async () => {
      const path = `/api/v1/items/${supplierItemId}`;
      const wrong = [
        { unit: "box" },
        { unit: null },
        { widthCm: 0 },
        { heightCm: 1.5 },
        { depthCm: 100001 },
        { weightKg: 1.2345 },
        { weightKg: 0 },
        { stock: -1 },
        { sku: "x".repeat(51) },
        { color: "" },
      ];
      for (const body of wrong) {
        expect((await send("PATCH", path, supplier, body)).status).toBe(422);
      }
    });

    test("a SKU is used once in a company, and another company can use it too", async () => {
      const first = await createItem(supplier, "Sku one", { sku: "SAME-1" });
      const second = await createItem(supplier, "Sku two");
      const body = { name: "Sku three", category: "Furniture", priceCents: 1, sku: "SAME-1" };

      const taken = await send("POST", "/api/v1/items", supplier, body);
      expect(taken.status).toBe(409);
      expect((await taken.json()).error.code).toBe("sku_taken");
      const path = `/api/v1/items/${second.id}`;
      expect((await send("PATCH", path, supplier, { sku: "SAME-1" })).status).toBe(409);

      // Saving an item again with its own SKU is fine. So is the same SKU in another company.
      const own = `/api/v1/items/${first.id}`;
      expect((await send("PATCH", own, supplier, { sku: "SAME-1", stock: 2 })).status).toBe(200);
      await createItem(customer, "Sku of a customer", { sku: "SAME-1" });
    });

    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

    function uploadPhoto(token: string, itemId: string, bytes: number[], type: string) {
      const form = new FormData();
      form.append("photo", new File([new Uint8Array(bytes)], "photo.png", { type }));
      return app.request(`/api/v1/items/${itemId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    }

    test("a photo upload is saved, served and checked by its content", async () => {
      const item = await createItem(supplier, "Photo chair");
      const uploaded = await uploadPhoto(supplier, item.id, png, "image/png");
      expect(uploaded.status).toBe(200);
      const { photoUrl, photos } = await uploaded.json();
      expect(photoUrl).toEndWith(".png");
      expect(photos).toEqual([{ id: expect.any(String), url: photoUrl }]);

      const served = await app.request(photoUrl);
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe("image/png");
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");

      // The browser says "image/png", but the content is text.
      const text = [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e];
      expect((await uploadPhoto(supplier, item.id, text, "image/png")).status).toBe(422);
      expect((await uploadPhoto(customer, item.id, png, "image/png")).status).toBe(404);
    });

    test("an item has up to 8 photos, in order, and the lists show them", async () => {
      const item = await createItem(supplier, "Many photos");
      const other = await createItem(supplier, "One photo");
      const jpg = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
      await uploadPhoto(supplier, other.id, jpg, "image/jpeg");
      const urls: string[] = [];
      for (let count = 1; count <= 8; count++) {
        const uploaded = await (await uploadPhoto(supplier, item.id, png, "image/png")).json();
        expect(uploaded.photos.length).toBe(count);
        urls.push(uploaded.photos[count - 1].url);
      }

      const tooMany = await uploadPhoto(supplier, item.id, png, "image/png");
      expect(tooMany.status).toBe(409);
      expect((await tooMany.json()).error.code).toBe("too_many_photos");

      // The list loads the photos of all its items. Each item gets its own, in order.
      const mine = await (await send("GET", "/api/v1/items/mine", supplier)).json();
      const listed = mine.find((row: { id: string }) => row.id === item.id);
      expect(listed.photos.map((photo: { url: string }) => photo.url)).toEqual(urls);
      expect(listed.photoUrl).toBe(urls[0]);
      const single = mine.find((row: { id: string }) => row.id === other.id);
      expect(single.photos.length).toBe(1);
      expect(single.photoUrl).toEndWith(".jpg");
    });

    test("a photo can become the cover and can be removed, only by its company", async () => {
      const item = await createItem(supplier, "Cover chair");
      type Photo = { id: string; url: string };
      let saved = { photos: [] as Photo[] };
      for (let count = 0; count < 3; count++) {
        saved = await (await uploadPhoto(supplier, item.id, png, "image/png")).json();
      }
      const [first, second, third] = saved.photos as [Photo, Photo, Photo];
      const photos = `/api/v1/items/${item.id}/photos`;

      // Another company, and also the admin, get 404.
      for (const token of [customer, admin]) {
        expect((await send("PUT", `${photos}/${third.id}/cover`, token)).status).toBe(404);
        expect((await send("DELETE", `${photos}/${third.id}`, token)).status).toBe(404);
      }
      // A photo of another item does not work with this item.
      const stranger = await createItem(supplier, "Stranger chair");
      const foreign = `/api/v1/items/${stranger.id}/photos/${third.id}`;
      expect((await send("DELETE", foreign, supplier)).status).toBe(404);
      expect((await send("PUT", `${foreign}/cover`, supplier)).status).toBe(404);

      // The new cover goes first. The others keep their order.
      const covered = await send("PUT", `${photos}/${third.id}/cover`, supplier);
      expect(covered.status).toBe(200);
      expect(await covered.json()).toMatchObject({
        photos: [third, first, second],
        photoUrl: third.url,
      });
      await send("PUT", `${photos}/${second.id}/cover`, supplier);
      const again = await (await send("GET", `/api/v1/items/${item.id}`, supplier)).json();
      expect(again.photos).toEqual([second, third, first]);

      // Removing the cover makes the next photo the cover. The file is gone.
      const removed = await send("DELETE", `${photos}/${second.id}`, supplier);
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({ photos: [third, first], photoUrl: third.url });
      expect((await app.request(second.url)).status).toBe(404);
      expect((await app.request(third.url)).status).toBe(200);
      expect((await send("DELETE", `${photos}/${second.id}`, supplier)).status).toBe(404);

      // A new photo goes to the end, also after the order changed.
      const added = await (await uploadPhoto(supplier, item.id, png, "image/png")).json();
      expect(added.photos.slice(0, 2)).toEqual([third, first]);
      expect(added.photos.length).toBe(3);
    });

    test("one item: the owner, an admin and a customer with it in the catalog can read it", async () => {
      const hidden = await createItem(supplier, "Secret hidden shelf", { hidden: true });
      const mine = await createItem(customer, "Customer private shelf");
      const foreign = await createItem(otherCustomer, "Other customer shelf");
      const shown = `/api/v1/items/${supplierItemId}`;

      expect((await (await send("GET", shown, supplier)).json()).name).toBe("Supplier chair");
      expect((await send("GET", shown, customer)).status).toBe(200);
      expect((await send("GET", `/api/v1/items/${mine.id}`, customer)).status).toBe(200);
      expect((await app.request(shown)).status).toBe(401);

      // A customer does not see a hidden item or an item of another customer.
      expect((await send("GET", `/api/v1/items/${hidden.id}`, customer)).status).toBe(404);
      expect((await send("GET", `/api/v1/items/${foreign.id}`, customer)).status).toBe(404);
      expect((await send("GET", `/api/v1/items/${mine.id}`, otherCustomer)).status).toBe(404);
      // A supplier sees only its own items.
      expect((await send("GET", `/api/v1/items/${mine.id}`, supplier)).status).toBe(404);
      expect((await send("GET", `/api/v1/items/${crypto.randomUUID()}`, admin)).status).toBe(404);

      // The owner and an admin see it also when it is hidden.
      for (const id of [hidden.id, mine.id, foreign.id]) {
        expect((await send("GET", `/api/v1/items/${id}`, admin)).status).toBe(200);
      }
      expect((await send("GET", `/api/v1/items/${hidden.id}`, supplier)).status).toBe(200);
    });

    test("a customer cannot read an item of a disabled company", async () => {
      const all = await (await send("GET", "/api/v1/items", admin)).json();
      const lamp = all.find((row: { name: string }) => row.name === "Gone supplier lamp");

      expect((await send("GET", `/api/v1/items/${lamp.id}`, customer)).status).toBe(404);
    });
  });

  describe("projects and orders", () => {
    type Line = {
      id: string;
      itemId: string;
      itemName: string;
      quantity: number;
      unitPriceCents: number;
      state: string;
      orderId: string | null;
    };
    type OrderRow = {
      id: string;
      number: string;
      supplierCompanyName: string;
      status: string;
      totalCents: number;
      lines: {
        itemName: string;
        quantity: number;
        unitPriceCents: number;
        lineTotalCents: number;
      }[];
    };
    type Detail = {
      project: { id: string; status: string; totalCents: number; [key: string]: unknown };
      lines: Line[];
      orders: OrderRow[];
    };

    let admin: string;
    let alpha: string;
    let beta: string;
    let customer: string;
    let otherCustomer: string;
    let booth: string;
    let chair: string;
    let spot: string;
    let truss: string;
    let banner: string;

    /** A supplier is approved at once here. `approval.test.ts` tests the waiting. */
    async function signUp(role: string, email: string, companyName: string) {
      return (await new Client(app).signUp(role, email, companyName)).token;
    }

    async function createItem(token: string, name: string, priceCents: number, extra: object = {}) {
      const body = { name, category: "Stand", priceCents, ...extra };
      const response = await send("POST", "/api/v1/items", token, body);
      expect(response.status).toBe(201);
      return (await response.json()) as { id: string; companyId: string };
    }

    function patchItem(token: string, id: string, body: object) {
      return send("PATCH", `/api/v1/items/${id}`, token, body);
    }

    async function createProject(name: string, token = customer) {
      const body = { name, startsOn: "2026-11-20", endsOn: "2026-11-23" };
      const response = await send("POST", "/api/v1/projects", token, body);
      expect(response.status).toBe(201);
      return (await response.json()).id as string;
    }

    function addLine(projectId: string, itemId: string, quantity: number, token = customer) {
      return send("POST", `/api/v1/projects/${projectId}/lines`, token, { itemId, quantity });
    }

    /** A new project of the customer with these lines: pairs of item id and quantity. */
    async function projectWith(name: string, lines: [string, number][]) {
      const id = await createProject(name);
      for (const [itemId, quantity] of lines) {
        expect((await addLine(id, itemId, quantity)).status).toBe(201);
      }
      return id;
    }

    async function detail(projectId: string, token = customer) {
      return (await (await send("GET", `/api/v1/projects/${projectId}`, token)).json()) as Detail;
    }

    function sendProject(projectId: string, body: object = {}) {
      return new Client(app).sendProject(projectId, customer, body);
    }

    function act(token: string, orderId: string, action: string, body?: object) {
      return send("POST", `/api/v1/orders/${orderId}/${action}`, token, body);
    }

    async function code(response: Response) {
      return (await response.json()).error.code as string;
    }

    function orderOf(found: Detail, supplierCompanyName: string) {
      const order = found.orders.find((row) => row.supplierCompanyName === supplierCompanyName);
      if (!order) {
        throw new Error(`No order for ${supplierCompanyName}`);
      }
      return order;
    }

    async function stockOf(token: string, itemId: string) {
      return (await (await send("GET", `/api/v1/items/${itemId}`, token)).json()).stock;
    }

    beforeAll(async () => {
      const account = { name: "Pm", email: "pm-admin@example.com", password: "a-long-password" };
      await authService.registerAdmin(account);
      admin = (await login(account.email)).token;
      alpha = await signUp("supplier", "alpha@pm.example", "Alpha Stands");
      beta = await signUp("supplier", "beta@pm.example", "Beta Light");
      customer = await signUp("customer", "cust@pm.example", "Cust Expo");
      otherCustomer = await signUp("customer", "other@pm.example", "Other Expo");

      booth = (await createItem(alpha, "Alpha booth", 50000, { unit: "set" })).id;
      chair = (await createItem(alpha, "Alpha chair", 1500, { stock: 10 })).id;
      spot = (await createItem(beta, "Beta spot", 2500)).id;
      truss = (await createItem(admin, "Admin truss", 1000, { unit: "meter" })).id;
      banner = (await createItem(customer, "Own banner", 999)).id;
    });

    test("happy path: one order per owner company, then accept, complete and done", async () => {
      const body = {
        name: "Auto Show",
        venue: "Expo Centre",
        city: "Yangon",
        hall: "B",
        boothNumber: "B-12",
        boothWidthCm: 600,
        boothDepthCm: 300,
        startsOn: "2026-11-20",
        endsOn: "2026-11-23",
        setupOn: "2026-11-19",
        notes: "Power on the left side.",
      };
      const created = await send("POST", "/api/v1/projects", customer, body);
      expect(created.status).toBe(201);
      const project = await created.json();
      expect(project).toMatchObject({
        ...body,
        companyName: "Cust Expo",
        status: "draft",
        orderCount: 0,
        pendingOrderCount: 0,
        lineCount: 0,
        totalCents: 0,
        cancelledAt: null,
        doneAt: null,
      });
      const id = project.id as string;
      const lines: [string, number][] = [
        [booth, 1],
        [chair, 4],
        [spot, 2],
        [truss, 3],
        [banner, 5],
      ];
      for (const [itemId, quantity] of lines) {
        expect((await addLine(id, itemId, quantity)).status).toBe(201);
      }

      const draft = await detail(id);
      expect(draft.orders).toEqual([]);
      expect(draft.lines.map((line) => [line.itemName, line.state, line.unitPriceCents])).toEqual([
        ["Alpha booth", "not_sent", 50000],
        ["Alpha chair", "not_sent", 1500],
        ["Beta spot", "not_sent", 2500],
        ["Admin truss", "not_sent", 1000],
        // An own item is free.
        ["Own banner", "own", 0],
      ]);
      expect(draft.lines[0]).toMatchObject({
        companyName: "Alpha Stands",
        category: "Stand",
        sku: null,
        unit: "set",
        stock: null,
      });

      const sent = await sendProject(id, { note: "Please deliver early." });
      expect(sent.status).toBe(200);
      const waiting = (await sent.json()) as Detail;
      expect(waiting.project).toMatchObject({
        status: "waiting",
        orderCount: 3,
        pendingOrderCount: 3,
        lineCount: 5,
        totalCents: 56000 + 5000 + 3000,
      });
      // Exactly one order per owner company. The own item is in no order.
      expect(waiting.orders.map((order) => order.supplierCompanyName).sort()).toEqual([
        "Alpha Stands",
        "Beta Light",
        "Exhibition Platform",
      ]);
      expect(new Set(waiting.orders.map((order) => order.number)).size).toBe(3);
      for (const order of waiting.orders) {
        expect(order.number).toMatch(/^ORD-\d{4,}$/);
        expect(order).toMatchObject({ status: "pending", note: "Please deliver early." });
      }
      const alphaOrder = orderOf(waiting, "Alpha Stands");
      expect(alphaOrder.totalCents).toBe(56000);
      expect(alphaOrder.lines).toMatchObject([
        {
          itemName: "Alpha booth",
          category: "Stand",
          sku: null,
          unit: "set",
          quantity: 1,
          unitPriceCents: 50000,
          lineTotalCents: 50000,
        },
        {
          itemName: "Alpha chair",
          unit: "piece",
          quantity: 4,
          unitPriceCents: 1500,
          lineTotalCents: 6000,
        },
      ]);
      expect(orderOf(waiting, "Beta Light")).toMatchObject({ totalCents: 5000, lineCount: 1 });
      expect(orderOf(waiting, "Exhibition Platform")).toMatchObject({
        totalCents: 3000,
        lineCount: 1,
      });
      const own = waiting.lines.find((line) => line.itemName === "Own banner");
      expect(own).toMatchObject({ state: "own", orderId: null });
      const sentLines = waiting.lines.filter((line) => line.state === "sent");
      expect(sentLines.length).toBe(4);
      expect(sentLines.every((line) => line.orderId !== null)).toBe(true);

      // A later change of the item does not change the order.
      const renamed = {
        name: "Renamed chair",
        category: "Seat",
        sku: "NEW-1",
        priceCents: 9999,
        unit: "set",
      };
      expect((await patchItem(alpha, chair, renamed)).status).toBe(200);
      const orderPath = `/api/v1/orders/${alphaOrder.id}`;
      const seen = await (await send("GET", orderPath, alpha)).json();
      expect(seen.totalCents).toBe(56000);
      expect(seen.lines[1]).toMatchObject({
        itemName: "Alpha chair",
        category: "Stand",
        sku: null,
        unit: "piece",
        unitPriceCents: 1500,
        lineTotalCents: 6000,
      });
      const after = await detail(id);
      expect(after.project.totalCents).toBe(64000);
      expect(after.lines[1]).toMatchObject({ unitPriceCents: 1500, lineTotalCents: 6000 });
      const old = { name: "Alpha chair", category: "Stand", sku: null, priceCents: 1500 };
      await patchItem(alpha, chair, { ...old, unit: "piece" });

      // The supplier sees the event and the contact of the customer through the order.
      expect(seen).toMatchObject({
        projectName: "Auto Show",
        customerCompanyName: "Cust Expo",
        customerContactEmail: "cust@pm.example",
        customerContactName: "Cust Expo",
        customerPhone: "",
        supplierContactName: "Alpha Stands",
        supplierPhone: "",
        project: { ...body, id },
      });
      expect(seen.supplierContactEmail).toEqual(expect.any(String));
      // A list row has the place of the event. "My items" counts the orders of an item.
      const listed = await (await send("GET", "/api/v1/orders", alpha)).json();
      expect(listed.find((row: { id: string }) => row.id === alphaOrder.id)).toMatchObject({
        venue: seen.project.venue,
        city: seen.project.city,
      });
      const mine = await (await send("GET", "/api/v1/items/mine", alpha)).json();
      // The booth is in this one order. An own item of the customer is in no order.
      expect(mine.find((item: { id: string }) => item.id === booth).orderCount).toBe(1);
      const ownItems = await (await send("GET", "/api/v1/items/mine", customer)).json();
      expect(ownItems.find((item: { id: string }) => item.id === banner).orderCount).toBe(0);

      // Accepting never lowers the stock. The order holds the items for its dates.
      const accepted = await act(alpha, alphaOrder.id, "accept");
      expect(accepted.status).toBe(200);
      const acceptedOrder = await accepted.json();
      expect(acceptedOrder.status).toBe("accepted");
      expect(acceptedOrder.decidedAt).not.toBeNull();
      expect(acceptedOrder.decidedBy).not.toBeNull();
      expect(await stockOf(alpha, chair)).toBe(10);
      expect((await detail(id)).project.status).toBe("waiting");

      expect((await act(beta, orderOf(waiting, "Beta Light").id, "accept")).status).toBe(200);
      // The admin company is the supplier of its own items.
      expect((await act(admin, orderOf(waiting, "Exhibition Platform").id, "accept")).status).toBe(
        200,
      );
      expect((await detail(id)).project).toMatchObject({
        status: "confirmed",
        pendingOrderCount: 0,
      });

      const completed = await (await act(alpha, alphaOrder.id, "complete")).json();
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();
      expect((await detail(id)).project).toMatchObject({ status: "confirmed", totalCents: 64000 });

      const done = await send("POST", `/api/v1/projects/${id}/done`, customer);
      expect(done.status).toBe(200);
      expect((await done.json()).project.status).toBe("done");

      // A done project is read only.
      const path = `/api/v1/projects/${id}`;
      const closed = [
        await send("PATCH", path, customer, { name: "New name" }),
        await addLine(id, spot, 1),
        await send("PATCH", `${path}/lines/${own?.id}`, customer, { quantity: 1 }),
        await send("DELETE", `${path}/lines/${own?.id}`, customer),
        await sendProject(id),
        await send("POST", `${path}/cancel`, customer),
        await send("POST", `${path}/done`, customer),
      ];
      for (const response of closed) {
        expect(response.status).toBe(409);
        expect(await code(response)).toBe("project_closed");
      }
      expect((await detail(id)).project.name).toBe("Auto Show");
    });

    test("the same item twice is one line, and a later send makes orders for new lines only", async () => {
      const id = await projectWith("Merge Fair", [
        [spot, 1],
        [spot, 2],
        [banner, 1],
        [banner, 1],
      ]);
      const merged = await detail(id);
      expect(merged.lines.map((line) => [line.itemName, line.quantity])).toEqual([
        ["Beta spot", 3],
        ["Own banner", 2],
      ]);

      // The note is optional.
      const first = (await (await sendProject(id)).json()) as Detail;
      expect(first.orders.length).toBe(1);
      expect(first.orders[0]).toMatchObject({ totalCents: 7500, note: "" });
      const nothing = await sendProject(id);
      expect(nothing.status).toBe(409);
      expect(await code(nothing)).toBe("nothing_to_send");
      expect((await detail(id)).orders.length).toBe(1);

      // A sent line cannot be changed or removed.
      const sentLine = first.lines.find((line) => line.state === "sent");
      const sentPath = `/api/v1/projects/${id}/lines/${sentLine?.id}`;
      const change = await send("PATCH", sentPath, customer, { quantity: 9 });
      expect(change.status).toBe(409);
      expect(await code(change)).toBe("line_sent");
      expect((await send("DELETE", sentPath, customer)).status).toBe(409);

      // The same item again makes a new line, because the old one is sent.
      expect((await addLine(id, spot, 4)).status).toBe(201);
      expect((await addLine(id, truss, 2)).status).toBe(201);
      const again = (await (await sendProject(id, { note: "More" })).json()) as Detail;
      expect(again.orders.length).toBe(3);
      const old = again.orders.find((order) => order.id === first.orders[0]?.id);
      expect(old).toMatchObject({ totalCents: 7500, note: "" });
      expect(old?.lines).toMatchObject([{ itemName: "Beta spot", quantity: 3 }]);
      const fresh = again.orders.filter((order) => order.id !== old?.id);
      expect(fresh.map((order) => order.totalCents).sort()).toEqual([10000, 2000]);
      expect(again.lines.map((line) => [line.itemName, line.quantity, line.state])).toEqual([
        ["Beta spot", 3, "sent"],
        ["Own banner", 2, "own"],
        ["Beta spot", 4, "sent"],
        ["Admin truss", 2, "sent"],
      ]);
      expect(again.project).toMatchObject({ orderCount: 3, totalCents: 19500, lineCount: 4 });
    });

    test("a line that is not sent can be changed and removed, an own item is never sent", async () => {
      const id = await projectWith("Own Fair", [
        [banner, 2],
        [spot, 1],
      ]);
      const [own, other] = (await detail(id)).lines as [Line, Line];
      const lines = `/api/v1/projects/${id}/lines`;

      const changed = await send("PATCH", `${lines}/${other.id}`, customer, { quantity: 7 });
      expect(changed.status).toBe(200);
      expect((await changed.json()).lines[1].quantity).toBe(7);
      expect((await send("PATCH", `${lines}/${own.id}`, customer, { quantity: 3 })).status).toBe(
        200,
      );
      for (const quantity of [0, 10001, 1.5]) {
        const wrong = await send("PATCH", `${lines}/${other.id}`, customer, { quantity });
        expect(wrong.status).toBe(422);
      }
      expect((await addLine(id, spot, 9999)).status).toBe(422);
      const missing = `${lines}/${crypto.randomUUID()}`;
      expect((await send("DELETE", missing, customer)).status).toBe(404);

      const removed = await send("DELETE", `${lines}/${other.id}`, customer);
      expect(removed.status).toBe(200);
      expect((await removed.json()).lines.map((line: Line) => line.quantity)).toEqual([3]);

      // Only an own item is left. There is nothing to send.
      const nothing = await sendProject(id);
      expect(await code(nothing)).toBe("nothing_to_send");
      expect((await detail(id)).project.status).toBe("draft");
    });

    test("stock: a too large quantity is refused on add, on send and on accept", async () => {
      const lamp = (await createItem(alpha, "Stock lamp", 100, { stock: 3 })).id;
      const id = await createProject("Stock Fair");

      const tooMany = await addLine(id, lamp, 4);
      expect(tooMany.status).toBe(422);
      expect(await code(tooMany)).toBe("not_enough_stock");
      expect((await addLine(id, lamp, 2)).status).toBe(201);
      // 2 more would make 4 on the same line.
      expect(await code(await addLine(id, lamp, 2))).toBe("not_enough_stock");
      const line = (await detail(id)).lines[0] as Line;
      expect(line.quantity).toBe(2);
      const linePath = `/api/v1/projects/${id}/lines/${line.id}`;
      expect((await send("PATCH", linePath, customer, { quantity: 4 })).status).toBe(422);
      expect((await send("PATCH", linePath, customer, { quantity: 3 })).status).toBe(200);

      // The stock went down after the item was added. The send is refused.
      await patchItem(alpha, lamp, { stock: 2 });
      const refused = await sendProject(id);
      expect(refused.status).toBe(409);
      const error = (await refused.json()).error;
      expect(error.code).toBe("not_enough_stock");
      expect(error.message).toContain("Stock lamp");
      expect((await detail(id)).orders).toEqual([]);

      await patchItem(alpha, lamp, { stock: 3 });
      const sent = (await (await sendProject(id)).json()) as Detail;
      const order = sent.orders[0] as OrderRow;

      // The stock went down again before the supplier answered. The accept is refused.
      await patchItem(alpha, lamp, { stock: 1 });
      const noStock = await act(alpha, order.id, "accept");
      expect(noStock.status).toBe(409);
      expect(await code(noStock)).toBe("not_enough_stock");
      expect(await stockOf(alpha, lamp)).toBe(1);
      expect((await detail(id)).orders[0]?.status).toBe("pending");

      await patchItem(alpha, lamp, { stock: 5 });
      expect((await act(alpha, order.id, "accept")).status).toBe(200);
      expect(await stockOf(alpha, lamp)).toBe(5);

      // Two items with a stock. The second one is too low, so the order is not accepted.
      const first = (await createItem(alpha, "Roll A", 100, { stock: 5 })).id;
      const second = (await createItem(alpha, "Roll B", 100, { stock: 5 })).id;
      const rolls = await projectWith("Roll Fair", [
        [first, 2],
        [second, 2],
      ]);
      const rollOrder = ((await (await sendProject(rolls)).json()) as Detail).orders[0] as OrderRow;
      await patchItem(alpha, second, { stock: 1 });
      expect((await act(alpha, rollOrder.id, "accept")).status).toBe(409);
      expect(await stockOf(alpha, first)).toBe(5);
      expect((await detail(rolls)).orders[0]?.status).toBe("pending");
      await patchItem(alpha, second, { stock: 2 });
      expect((await act(alpha, rollOrder.id, "accept")).status).toBe(200);
      expect([await stockOf(alpha, first), await stockOf(alpha, second)]).toEqual([5, 2]);
    });

    test("send is all or nothing: one bad line means no order at all", async () => {
      const shelf = (await createItem(alpha, "Atomic shelf", 700)).id;
      const id = await projectWith("Atomic Fair", [
        [spot, 1],
        [truss, 1],
        [shelf, 1],
      ]);

      const before = (await (await send("GET", "/api/v1/orders", beta)).json()).length;
      await patchItem(alpha, shelf, { hidden: true });
      const refused = await sendProject(id);
      expect(refused.status).toBe(409);
      const error = (await refused.json()).error;
      expect(error.code).toBe("item_unavailable");
      expect(error.message).toContain("Atomic shelf");
      const untouched = await detail(id);
      expect(untouched.orders).toEqual([]);
      expect(untouched.project).toMatchObject({ status: "draft", orderCount: 0, totalCents: 0 });
      expect(untouched.lines.every((line) => line.state === "not_sent")).toBe(true);
      expect((await (await send("GET", "/api/v1/orders", beta)).json()).length).toBe(before);

      await patchItem(alpha, shelf, { hidden: false });
      const sent = (await (await sendProject(id)).json()) as Detail;
      expect(sent.orders.length).toBe(3);
    });

    test("reject needs a reason, and every wrong status change is 409", async () => {
      const id = await projectWith("Status Fair", [
        [booth, 1],
        [spot, 1],
        [truss, 1],
      ]);
      const sent = (await (await sendProject(id)).json()) as Detail;
      const alphaOrder = orderOf(sent, "Alpha Stands").id;
      const betaOrder = orderOf(sent, "Beta Light").id;
      const adminOrder = orderOf(sent, "Exhibition Platform").id;

      async function allRefused(steps: [string, string, string][]) {
        for (const [token, orderId, action] of steps) {
          const response = await act(token, orderId, action, { reason: "No." });
          expect(response.status).toBe(409);
          expect(await code(response)).toBe("invalid_status");
        }
      }

      for (const body of [{}, { reason: " " }, { reason: "x".repeat(1001) }]) {
        expect((await act(alpha, alphaOrder, "reject", body)).status).toBe(422);
      }
      const rejected = await act(alpha, alphaOrder, "reject", { reason: "Fully booked." });
      expect(rejected.status).toBe(200);
      expect(await rejected.json()).toMatchObject({
        status: "rejected",
        rejectReason: "Fully booked.",
      });
      // A rejected order does not count in the total of the project.
      expect((await detail(id)).project).toMatchObject({
        status: "waiting",
        orderCount: 3,
        pendingOrderCount: 2,
        totalCents: 3500,
      });
      await allRefused([
        [alpha, alphaOrder, "accept"],
        [alpha, alphaOrder, "reject"],
        [alpha, alphaOrder, "complete"],
        [customer, alphaOrder, "cancel"],
        // A pending order cannot be completed.
        [beta, betaOrder, "complete"],
      ]);

      const cancelled = await act(customer, betaOrder, "cancel");
      expect((await cancelled.json()).status).toBe("cancelled");
      await allRefused([
        [beta, betaOrder, "accept"],
        [beta, betaOrder, "reject"],
        [beta, betaOrder, "complete"],
        [customer, betaOrder, "cancel"],
      ]);

      expect((await act(admin, adminOrder, "accept")).status).toBe(200);
      await allRefused([
        [admin, adminOrder, "accept"],
        [admin, adminOrder, "reject"],
        [customer, adminOrder, "cancel"],
      ]);
      // An order is accepted. The project cannot be cancelled any more.
      const cancel = await send("POST", `/api/v1/projects/${id}/cancel`, customer);
      expect(cancel.status).toBe(409);
      expect(await code(cancel)).toBe("invalid_status");

      expect((await act(admin, adminOrder, "complete")).status).toBe(200);
      await allRefused([
        [admin, adminOrder, "accept"],
        [admin, adminOrder, "reject"],
        [admin, adminOrder, "complete"],
        [customer, adminOrder, "cancel"],
      ]);
      expect((await detail(id)).project).toMatchObject({ status: "confirmed", totalCents: 1000 });
      expect((await send("POST", `/api/v1/projects/${id}/cancel`, customer)).status).toBe(409);
    });

    test("cancel a project: it cancels the pending orders, and is refused after an accept", async () => {
      const id = await projectWith("Cancel Fair", [
        [booth, 1],
        [spot, 1],
      ]);
      const path = `/api/v1/projects/${id}`;
      // A project that is not confirmed cannot be marked as done.
      expect(await code(await send("POST", `${path}/done`, customer))).toBe("invalid_status");
      const sent = (await (await sendProject(id)).json()) as Detail;
      expect(await code(await send("POST", `${path}/done`, customer))).toBe("invalid_status");

      const cancelled = await send("POST", `${path}/cancel`, customer);
      expect(cancelled.status).toBe(200);
      const after = (await cancelled.json()) as Detail;
      expect(after.project).toMatchObject({
        status: "cancelled",
        pendingOrderCount: 0,
        totalCents: 0,
      });
      expect(after.project.cancelledAt).not.toBeNull();
      expect(after.orders.map((order) => order.status)).toEqual(["cancelled", "cancelled"]);
      const order = orderOf(sent, "Alpha Stands").id;
      expect(await code(await act(alpha, order, "accept"))).toBe("invalid_status");
      expect(await code(await send("POST", `${path}/cancel`, customer))).toBe("project_closed");
      expect(await code(await sendProject(id))).toBe("project_closed");

      // One order is accepted. The cancel is refused and the other order stays pending.
      const second = await projectWith("Late Cancel Fair", [
        [booth, 1],
        [spot, 1],
      ]);
      const open = (await (await sendProject(second)).json()) as Detail;
      expect((await act(beta, orderOf(open, "Beta Light").id, "accept")).status).toBe(200);
      const late = await send("POST", `/api/v1/projects/${second}/cancel`, customer);
      expect(late.status).toBe(409);
      const still = await detail(second);
      expect(still.project).toMatchObject({ status: "waiting", cancelledAt: null });
      expect(orderOf(still, "Alpha Stands").status).toBe("pending");

      // A draft with no orders can be cancelled too.
      const draft = await createProject("Draft Fair");
      const gone = await send("POST", `/api/v1/projects/${draft}/cancel`, customer);
      expect((await gone.json()).project.status).toBe("cancelled");
    });

    test("project input: the dates must be real and in order", async () => {
      const base = { name: "Date Fair", startsOn: "2026-11-20", endsOn: "2026-11-23" };
      const wrong = [
        { ...base, endsOn: "2026-11-19" },
        { ...base, setupOn: "2026-11-21" },
        { ...base, startsOn: "2026-13-40" },
        { ...base, startsOn: "20-11-2026" },
        { ...base, name: "" },
        { ...base, venue: "x".repeat(151) },
        { ...base, boothWidthCm: 0 },
        { name: "No dates" },
      ];
      for (const body of wrong) {
        expect((await send("POST", "/api/v1/projects", customer, body)).status).toBe(422);
      }

      const id = await createProject("Date Fair");
      const path = `/api/v1/projects/${id}`;
      // The new end date is checked against the start date that is saved.
      expect((await send("PATCH", path, customer, { endsOn: "2026-11-19" })).status).toBe(422);
      expect((await send("PATCH", path, customer, { setupOn: "2026-11-21" })).status).toBe(422);
      const changed = await send("PATCH", path, customer, {
        endsOn: "2026-11-20",
        setupOn: "2026-11-20",
        city: "Mandalay",
        boothWidthCm: 400,
      });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({
        name: "Date Fair",
        endsOn: "2026-11-20",
        setupOn: "2026-11-20",
        city: "Mandalay",
        boothWidthCm: 400,
      });
      const cleared = await send("PATCH", path, customer, { setupOn: null, boothWidthCm: null });
      expect(await cleared.json()).toMatchObject({ setupOn: null, boothWidthCm: null });
    });

    test("only items of my catalog can be added", async () => {
      const id = await createProject("Catalog Fair");
      const hidden = await createItem(alpha, "Hidden wall", 100, { hidden: true });
      const foreign = await createItem(otherCustomer, "Other flag", 100);
      const gone = await signUp("supplier", "gone@pm.example", "Gone Stands");
      const lamp = await createItem(gone, "Gone lamp", 100);
      const company = `/api/v1/companies/${lamp.companyId}`;
      expect((await send("PATCH", company, admin, { disabled: true })).status).toBe(200);

      for (const itemId of [hidden.id, foreign.id, lamp.id, crypto.randomUUID()]) {
        expect((await addLine(id, itemId, 1)).status).toBe(404);
      }
      expect((await detail(id)).lines).toEqual([]);
    });

    test("access: a project belongs to its customer, an order to its two companies", async () => {
      const id = await projectWith("Access Fair", [
        [booth, 1],
        [spot, 1],
        [truss, 1],
      ]);
      const sent = (await (await sendProject(id)).json()) as Detail;
      const alphaOrder = orderOf(sent, "Alpha Stands").id;
      const adminOrder = orderOf(sent, "Exhibition Platform").id;
      const lineId = (sent.lines[0] as Line).id;
      const path = `/api/v1/projects/${id}`;

      // Another customer gets 404 on the project and its lines.
      const blocked: [string, string, object?][] = [
        ["GET", path],
        ["PATCH", path, { name: "Stolen" }],
        ["POST", `${path}/lines`, { itemId: truss, quantity: 1 }],
        ["PATCH", `${path}/lines/${lineId}`, { quantity: 2 }],
        ["DELETE", `${path}/lines/${lineId}`],
        ["POST", `${path}/send`, { expectedTotalCents: 0 }],
        ["POST", `${path}/cancel`],
        ["POST", `${path}/done`],
      ];
      for (const [method, url, body] of blocked) {
        expect((await send(method, url, otherCustomer, body)).status).toBe(404);
      }
      expect((await send("GET", `/api/v1/orders/${alphaOrder}`, otherCustomer)).status).toBe(404);
      expect((await act(otherCustomer, alphaOrder, "cancel")).status).toBe(404);
      expect(await (await send("GET", "/api/v1/projects", otherCustomer)).json()).toEqual([]);
      expect(await (await send("GET", "/api/v1/orders", otherCustomer)).json()).toEqual([]);
      expect((await app.request(path)).status).toBe(401);
      expect((await app.request("/api/v1/orders")).status).toBe(401);

      // A supplier cannot read projects. It sees the event only through its own orders.
      expect((await send("GET", "/api/v1/projects", alpha)).status).toBe(403);
      expect((await send("GET", path, alpha)).status).toBe(403);
      expect((await send("POST", "/api/v1/projects", alpha, {})).status).toBe(403);
      const forAlpha = await (await send("GET", "/api/v1/orders", alpha)).json();
      expect(forAlpha.length).toBeGreaterThan(0);
      for (const order of forAlpha) {
        expect(order.supplierCompanyName).toBe("Alpha Stands");
      }
      expect(forAlpha[0]).toMatchObject({
        projectName: expect.any(String),
        customerCompanyName: "Cust Expo",
        startsOn: "2026-11-20",
        endsOn: "2026-11-23",
        lineCount: expect.any(Number),
        createdAt: expect.any(String),
      });
      // The order of a supplier has only its own lines.
      const mine = await (await send("GET", `/api/v1/orders/${alphaOrder}`, alpha)).json();
      expect(mine.lines.map((line: { itemName: string }) => line.itemName)).toEqual([
        "Alpha booth",
      ]);
      expect((await send("GET", `/api/v1/orders/${alphaOrder}`, beta)).status).toBe(404);
      for (const action of ["accept", "reject", "complete", "cancel"]) {
        const response = await act(beta, alphaOrder, action, { reason: "No." });
        expect(response.status).toBe(404);
      }
      // There is no list of every order. An old `all=true` changes nothing for anybody.
      const notAll = await (await send("GET", "/api/v1/orders?all=true", alpha)).json();
      expect(
        notAll.every(
          (o: { supplierCompanyName: string }) => o.supplierCompanyName === "Alpha Stands",
        ),
      ).toBe(true);

      // The customer can read its orders, but cannot answer them. The supplier cannot cancel.
      expect((await send("GET", `/api/v1/orders/${alphaOrder}`, customer)).status).toBe(200);
      for (const action of ["accept", "reject", "complete"]) {
        const response = await act(customer, alphaOrder, action, { reason: "No." });
        expect(response.status).toBe(403);
      }
      // The supplier cancels only an order they accepted, and must give a reason.
      expect((await act(alpha, alphaOrder, "cancel")).status).toBe(422);
      expect((await act(alpha, alphaOrder, "cancel", { reason: "No." })).status).toBe(409);
      const forCustomer = await (await send("GET", "/api/v1/orders", customer)).json();
      expect(
        forCustomer.every(
          (o: { customerCompanyName: string }) => o.customerCompanyName === "Cust Expo",
        ),
      ).toBe(true);
      expect(
        forCustomer.filter((order: { projectId: string }) => order.projectId === id).length,
      ).toBe(3);

      // An admin reads every project and every order, but changes only the orders of its company.
      const every = await (await send("GET", "/api/v1/projects", admin)).json();
      const listed = every.find((project: { id: string }) => project.id === id);
      expect(listed).toMatchObject({ companyName: "Cust Expo", status: "waiting", orderCount: 3 });
      expect((await detail(id, admin)).orders.length).toBe(3);
      expect((await send("GET", `/api/v1/orders/${alphaOrder}`, admin)).status).toBe(200);
      const forAdmin = await (await send("GET", "/api/v1/orders?all=true", admin)).json();
      expect(
        forAdmin.every(
          (o: { supplierCompanyName: string }) => o.supplierCompanyName === "Exhibition Platform",
        ),
      ).toBe(true);
      // An admin cannot answer for a supplier. Cancelling with a reason is its own test.
      for (const action of ["accept", "reject", "complete"]) {
        const response = await act(admin, alphaOrder, action, { reason: "No." });
        expect(response.status).toBe(403);
      }
      expect((await act(admin, alphaOrder, "cancel")).status).toBe(422);
      const adminWrites: [string, string, object?][] = [
        ["POST", "/api/v1/projects", { name: "X", startsOn: "2026-01-01", endsOn: "2026-01-02" }],
        ["PATCH", path, { name: "Admin name" }],
        ["POST", `${path}/lines`, { itemId: truss, quantity: 1 }],
        ["POST", `${path}/send`, { expectedTotalCents: 0 }],
        ["POST", `${path}/cancel`],
      ];
      for (const [method, url, body] of adminWrites) {
        expect((await send(method, url, admin, body)).status).toBe(403);
      }
      // Nothing changed.
      const after = await detail(id);
      expect(after.project).toMatchObject({ name: "Access Fair", status: "waiting" });
      expect(after.orders.every((order) => order.status === "pending")).toBe(true);
      expect((await act(admin, adminOrder, "accept")).status).toBe(200);
    });

    test("the lists can be filtered by status", async () => {
      const drafts = await (await send("GET", "/api/v1/projects?status=draft", customer)).json();
      expect(drafts.length).toBeGreaterThan(0);
      expect(drafts.every((project: { status: string }) => project.status === "draft")).toBe(true);
      const done = await (await send("GET", "/api/v1/projects?status=done", customer)).json();
      expect(done.map((project: { name: string }) => project.name)).toEqual(["Auto Show"]);
      expect((await send("GET", "/api/v1/projects?status=open", customer)).status).toBe(422);

      const rejected = await (await send("GET", "/api/v1/orders?status=rejected", alpha)).json();
      expect(rejected.length).toBe(1);
      expect(rejected[0]).toMatchObject({ status: "rejected", projectName: "Status Fair" });
      expect((await send("GET", "/api/v1/orders?status=open", alpha)).status).toBe(422);
    });
  });

  test("a company manages its own users, and an admin can do it for them", async () => {
    const registered = await post("/api/v1/auth/register", {
      name: "Owner",
      email: "owner@team.example",
      password: "a-long-password",
      role: "customer",
      companyName: "Team Co",
    });
    const owner = await registered.json();
    await post("/api/v1/auth/register", {
      name: "Stranger",
      email: "stranger@other.example",
      password: "a-long-password",
      role: "supplier",
      companyName: "Other Co",
    });
    const stranger = (await login("stranger@other.example")).token;
    const account = { name: "Boss", email: "boss@example.com", password: "a-long-password" };
    await authService.registerAdmin(account);
    const admin = (await login(account.email)).token;
    const mate = { name: "Mate", email: "mate@team.example", password: "a-long-password" };

    // The owner adds a teammate. The teammate gets the same company and role.
    const created = await send("POST", "/api/v1/users", owner.token, mate);
    expect(created.status).toBe(201);
    const teammate = await created.json();
    expect(teammate.companyId).toBe(owner.user.companyId);
    expect(teammate.role).toBe("customer");
    expect(teammate.isOwner).toBe(false);
    expect(owner.user.isOwner).toBe(true);
    const mateToken = (await login(mate.email)).token;

    const list = await (await send("GET", "/api/v1/users", mateToken)).json();
    expect(list.map((user: { name: string }) => user.name)).toEqual(["Owner", "Mate"]);

    // Another company cannot see, add or remove them.
    const byCompany = `/api/v1/users?companyId=${owner.user.companyId}`;
    expect((await send("GET", byCompany, stranger)).status).toBe(404);
    const intruder = { ...mate, email: "x@other.example", companyId: owner.user.companyId };
    expect((await send("POST", "/api/v1/users", stranger, intruder)).status).toBe(404);
    expect((await send("DELETE", `/api/v1/users/${teammate.id}`, stranger)).status).toBe(404);

    // A user who is not the owner can see the team, but cannot change it.
    const extra = { ...mate, email: "extra@team.example" };
    expect((await send("POST", "/api/v1/users", mateToken, extra)).status).toBe(403);
    expect((await send("DELETE", `/api/v1/users/${teammate.id}`, mateToken)).status).toBe(403);

    // An admin can do all of it for the company.
    expect((await (await send("GET", byCompany, admin)).json()).length).toBe(2);
    const byAdmin = { ...mate, email: "third@team.example", companyId: owner.user.companyId };
    const third = await send("POST", "/api/v1/users", admin, byAdmin);
    expect((await third.json()).companyId).toBe(owner.user.companyId);

    // Nobody can remove the owner. A removed user is logged out at once.
    expect((await send("DELETE", `/api/v1/users/${owner.user.id}`, owner.token)).status).toBe(409);
    expect((await send("DELETE", `/api/v1/users/${owner.user.id}`, admin)).status).toBe(409);
    expect((await send("DELETE", `/api/v1/users/${teammate.id}`, owner.token)).status).toBe(204);
    expect((await me(mateToken)).status).toBe(401);
    expect((await login(mate.email)).status).toBe(401);
  });

  test("me without a token gets 401", async () => {
    const response = await app.request("/api/v1/users/me");

    expect(response.status).toBe(401);
  });

  test("the OpenAPI spec lists every endpoint", async () => {
    const spec = await (await app.request("/api/v1/openapi.json")).json();

    expect(Object.keys(spec.paths).sort()).toEqual([
      "/api/v1/admin-actions",
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/logout-all",
      "/api/v1/auth/register",
      "/api/v1/auth/stop-impersonating",
      "/api/v1/companies",
      "/api/v1/companies/{id}",
      "/api/v1/companies/{id}/approve",
      "/api/v1/companies/{id}/impersonate",
      "/api/v1/company",
      "/api/v1/dashboard",
      "/api/v1/items",
      "/api/v1/items/catalog",
      "/api/v1/items/categories",
      "/api/v1/items/mine",
      "/api/v1/items/{id}",
      "/api/v1/items/{id}/photos",
      "/api/v1/items/{id}/photos/{photoId}",
      "/api/v1/items/{id}/photos/{photoId}/cover",
      "/api/v1/notifications",
      "/api/v1/notifications/read",
      "/api/v1/notifications/{id}/read",
      "/api/v1/orders",
      "/api/v1/orders/{id}",
      "/api/v1/orders/{id}/accept",
      "/api/v1/orders/{id}/cancel",
      "/api/v1/orders/{id}/complete",
      "/api/v1/orders/{id}/reject",
      "/api/v1/organizations",
      "/api/v1/organizations/{id}",
      "/api/v1/organizations/{id}/companies/{companyId}",
      "/api/v1/projects",
      "/api/v1/projects/{id}",
      "/api/v1/projects/{id}/cancel",
      "/api/v1/projects/{id}/done",
      "/api/v1/projects/{id}/lines",
      "/api/v1/projects/{id}/lines/{lineId}",
      "/api/v1/projects/{id}/orders/{orderId}/add-again",
      "/api/v1/projects/{id}/send",
      "/api/v1/users",
      "/api/v1/users/me",
      "/api/v1/users/me/password",
      "/api/v1/users/{id}",
      "/api/v1/users/{id}/password",
    ]);
  });

  test("a page is HTML on first visit and JSON on an Inertia visit", async () => {
    const first = await app.request("/login");
    expect(first.headers.get("Content-Type")).toContain("text/html");
    expect(await first.text()).toContain('data-page="app"');

    const next = await app.request("/login", {
      headers: { "X-Inertia": "true", "X-Inertia-Version": "dev" },
    });
    expect(next.headers.get("X-Inertia")).toBe("true");
    expect((await next.json()).component).toBe("Login");
  });
});
