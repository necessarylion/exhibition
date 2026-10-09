import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildApp, Client, PASSWORD, type TestApp } from "./support/build-app";

const NEW_PASSWORD = "another-long-password";

describe("account", () => {
  let context: TestApp;
  let client: Client;

  function me(token: string) {
    return client.send("GET", "/api/v1/users/me", token);
  }

  async function code(response: Response) {
    return (await response.json()).error.code as string;
  }

  beforeAll(async () => {
    context = await buildApp();
    client = new Client(context.app);
  });

  afterAll(async () => {
    await context.sql.close();
  });

  test("I can change my name", async () => {
    const { token } = await client.signUp("customer", "name@acc.example", "Name Co");

    const renamed = await client.send("PATCH", "/api/v1/users/me", token, { name: "  Mya Mya " });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).name).toBe("Mya Mya");
    expect((await (await me(token)).json()).name).toBe("Mya Mya");

    expect((await client.send("PATCH", "/api/v1/users/me", token, { name: " " })).status).toBe(422);
    const long = { name: "x".repeat(101) };
    expect((await client.send("PATCH", "/api/v1/users/me", token, long)).status).toBe(422);
    expect((await client.post("/api/v1/users/me", {})).status).toBe(404);
  });

  test("a password change needs the current password and logs out my other devices", async () => {
    const { token: here } = await client.signUp("customer", "pass@acc.example", "Pass Co");
    const elsewhere = (await client.login("pass@acc.example")).token;
    const path = "/api/v1/users/me/password";

    const wrong = await client.send("POST", path, here, {
      currentPassword: "not-my-password",
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.status).toBe(422);
    expect(await code(wrong)).toBe("wrong_password");
    const short = { currentPassword: PASSWORD, newPassword: "short" };
    expect(await code(await client.send("POST", path, here, short))).toBe("validation_failed");
    // Nothing changed so far.
    expect((await me(elsewhere)).status).toBe(200);

    const changed = await client.send("POST", path, here, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(204);

    // The token of this request lives. The other token is dead.
    expect((await me(here)).status).toBe(200);
    expect((await me(elsewhere)).status).toBe(401);
    expect((await client.login("pass@acc.example")).status).toBe(401);
    expect((await client.login("pass@acc.example", NEW_PASSWORD)).status).toBe(200);
  });

  test("logout-all kills every token of mine, and only mine", async () => {
    const { token: first } = await client.signUp("supplier", "all@acc.example", "All Co");
    const second = (await client.login("all@acc.example")).token;
    const { token: bystander } = await client.signUp("supplier", "by@acc.example", "By Co");

    expect((await client.post("/api/v1/auth/logout-all", {})).status).toBe(401);
    expect((await client.post("/api/v1/auth/logout-all", {}, first)).status).toBe(204);

    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(401);
    expect((await me(bystander)).status).toBe(200);
    expect((await client.login("all@acc.example")).status).toBe(200);
  });

  test("the owner or an admin of another company sets a new password for a teammate", async () => {
    const owner = await client.signUp("customer", "owner@reset.example", "Reset Co");
    const mate = { name: "Mate", email: "mate@reset.example", password: PASSWORD };
    const teammate = await (await client.send("POST", "/api/v1/users", owner.token, mate)).json();
    const mateToken = (await client.login(mate.email)).token;
    const stranger = await client.signUp("supplier", "stranger@reset.example", "Stranger Co");
    const account = { name: "Boss", email: "boss@reset.example", password: PASSWORD };
    await context.authService.registerAdmin(account);
    const admin = (await client.login(account.email)).token;
    const path = `/api/v1/users/${teammate.id}/password`;
    const ownerPath = `/api/v1/users/${owner.user.id}/password`;
    const body = { newPassword: NEW_PASSWORD };

    // Not the owner: 403. Another company: 404. The owner for themselves: 403.
    expect((await client.send("POST", ownerPath, mateToken, body)).status).toBe(403);
    expect((await client.send("POST", path, mateToken, body)).status).toBe(403);
    expect((await client.send("POST", path, stranger.token, body)).status).toBe(404);
    expect((await client.send("POST", ownerPath, owner.token, body)).status).toBe(403);
    const missing = `/api/v1/users/${crypto.randomUUID()}/password`;
    expect((await client.send("POST", missing, owner.token, body)).status).toBe(404);
    expect((await client.send("POST", path, owner.token, { newPassword: "short" })).status).toBe(
      422,
    );
    // Nothing changed so far.
    expect((await me(mateToken)).status).toBe(200);
    expect((await client.login(mate.email)).status).toBe(200);

    // The owner does it. The teammate is logged out and logs in with the new password.
    expect((await client.send("POST", path, owner.token, body)).status).toBe(204);
    expect((await me(mateToken)).status).toBe(401);
    expect((await client.login(mate.email)).status).toBe(401);
    const again = (await client.login(mate.email, NEW_PASSWORD)).token;
    expect((await me(again)).status).toBe(200);
    expect((await me(owner.token)).status).toBe(200);

    // An admin does it for a user of another company.
    const byAdmin = { newPassword: "the-third-long-password" };
    expect((await client.send("POST", path, admin, byAdmin)).status).toBe(204);
    expect((await me(again)).status).toBe(401);
    expect((await client.login(mate.email, byAdmin.newPassword)).status).toBe(200);
  });

  describe("company profile", () => {
    let owner: string;
    let mate: string;
    let customer: string;
    let itemId: string;
    const profile = {
      name: "Profile Supply Ltd",
      phone: "+95 9 123 456",
      address: "12 Main Road, Yangon",
      website: "https://profile.example/shop",
      about: "We build booths.",
    };

    beforeAll(async () => {
      owner = (await client.signUp("supplier", "owner@profile.example", "Profile Supply")).token;
      const account = { name: "Mate", email: "mate@profile.example", password: PASSWORD };
      await client.send("POST", "/api/v1/users", owner, account);
      mate = (await client.login(account.email)).token;
      customer = (await client.signUp("customer", "cust@profile.example", "Profile Buyer")).token;
      const item = { name: "Profile booth", category: "Stand", priceCents: 100 };
      itemId = (await (await client.send("POST", "/api/v1/items", owner, item)).json()).id;
    });

    test("the owner edits the profile and every user of the company reads it", async () => {
      expect(await client.json("/api/v1/company", mate)).toEqual({
        id: expect.any(String),
        name: "Profile Supply",
        type: "supplier",
        phone: "",
        address: "",
        website: "",
        about: "",
        approvedAt: expect.any(String),
        createdAt: expect.any(String),
        organization: null,
      });

      const updated = await client.send("PATCH", "/api/v1/company", owner, profile);
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject(profile);
      expect(await client.json("/api/v1/company", mate)).toMatchObject(profile);
      // The new name shows on the user too.
      expect((await (await me(mate)).json()).companyName).toBe(profile.name);

      // A field that is not sent stays. Empty text clears a field.
      const cleared = await client.send("PATCH", "/api/v1/company", owner, { website: "" });
      expect(await cleared.json()).toMatchObject({ ...profile, website: "" });
      await client.send("PATCH", "/api/v1/company", owner, { website: profile.website });
    });

    test("a user who is not the owner cannot edit it", async () => {
      const response = await client.send("PATCH", "/api/v1/company", mate, { phone: "000" });

      expect(response.status).toBe(403);
      expect((await client.json("/api/v1/company", owner)).phone).toBe(profile.phone);
      expect((await context.app.request("/api/v1/company")).status).toBe(401);
    });

    test("the website must be an http or https link, and the fields have a size limit", async () => {
      const wrong = [
        { website: "profile.example" },
        { website: "ftp://profile.example" },
        { website: "javascript:alert(1)" },
        { website: "https://" },
        { website: `https://x.example/${"a".repeat(200)}` },
        { phone: "1".repeat(51) },
        { address: "a".repeat(301) },
        { about: "a".repeat(2001) },
        { name: "" },
      ];
      for (const body of wrong) {
        expect((await client.send("PATCH", "/api/v1/company", owner, body)).status).toBe(422);
      }
      const ok = await client.send("PATCH", "/api/v1/company", owner, {
        website: "http://profile.example",
      });
      expect(ok.status).toBe(200);
      await client.send("PATCH", "/api/v1/company", owner, { website: profile.website });
    });

    test("a customer sees the supplier profile on one item, not in the lists", async () => {
      const item = await client.json(`/api/v1/items/${itemId}`, customer);
      expect(item).toMatchObject({
        name: "Profile booth",
        companyName: profile.name,
        companyPhone: profile.phone,
        companyWebsite: profile.website,
        companyAbout: profile.about,
      });
      // The address is not public.
      expect(item.companyAddress).toBeUndefined();

      const catalog = await client.json("/api/v1/items/catalog", customer);
      expect(catalog[0].name).toBe("Profile booth");
      expect(catalog[0].companyPhone).toBeUndefined();
    });
  });
});
