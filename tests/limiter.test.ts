import { describe, expect, test } from "bun:test";
import { RATE_LIMIT_MAX_KEYS, RATE_LIMIT_WINDOW_MS } from "../app/constants/rate-limit.constants";
import { network } from "../app/middleware/rate-limit.middleware";
import { RateLimiter } from "../app/services/rate-limiter.service";
import { PASSWORD, type TestApp, TestClock } from "./support/build-app";
import { API, tally, World } from "./support/world";

function login(app: TestApp["app"], email: string, password: string, forwarded?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (forwarded) {
    headers["X-Forwarded-For"] = forwarded;
  }
  return app.request(`${API}/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
}

const LIMITS = { RATE_LIMIT_MAX: "10", RATE_LIMIT_IP_MAX: "50", TRUSTED_PROXIES: "1" };

describe("the login limiter (D15)", () => {
  test("a full limiter never refuses a right login or a sign-up (review2 M1)", async () => {
    const world = await World.create(LIMITS);
    await world.customer("Honest Co");
    const limiter = world.context.limiter;
    // What a flood of wrong logins from many addresses leaves behind.
    for (let index = 0; index < RATE_LIMIT_MAX_KEYS + 50; index++) {
      limiter.hit(`junk ${index}`, 10);
    }
    expect(limiter.size).toBe(RATE_LIMIT_MAX_KEYS);

    const email = world.email("Honest Co");
    expect((await login(world.context.app, email, PASSWORD, "203.0.113.5")).status).toBe(200);
    const signUp = await world.context.app.request(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.77" },
      body: JSON.stringify({
        name: "New",
        email: "new@full.example",
        password: PASSWORD,
        role: "customer",
        companyName: "New Co",
      }),
    });
    expect(signUp.status).toBe(201);
    // It never gets bigger: the oldest keys went out.
    expect(limiter.size).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
    await world.close();
  });

  test("a full limiter drops the windows that are over first, then the oldest keys", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock);
    limiter.hit("old", 10);
    clock.time += RATE_LIMIT_WINDOW_MS;
    limiter.hit("first of the new window", 1);
    for (let index = 2; index < RATE_LIMIT_MAX_KEYS; index++) {
      limiter.hit(`fill ${index}`, 1);
    }
    expect(limiter.size).toBe(RATE_LIMIT_MAX_KEYS);
    // One more key: only the key whose window is over goes.
    limiter.hit("one more", 1);
    expect(limiter.size).toBe(RATE_LIMIT_MAX_KEYS);
    expect(() => limiter.hit("first of the new window", 1)).toThrow("Too many attempts");
    // Still full, and no window is over: now the oldest key goes.
    limiter.hit("and one more", 1);
    expect(() => limiter.hit("first of the new window", 1)).not.toThrow();
  });

  test("wrong logins at the same moment cannot pass the limit together (review2 M2)", async () => {
    const world = await World.create({ RATE_LIMIT_MAX: "10", RATE_LIMIT_IP_MAX: "50" });
    await world.customer("Victim Co");
    const tries = [];
    for (let index = 0; index < 120; index++) {
      tries.push(login(world.context.app, world.email("Victim Co"), `wrong-password-${index}`));
    }
    const statuses = tally(await Promise.all(tries));
    // 10 per address and email. Every other request is refused before the password check.
    expect(statuses).toEqual({ 401: 10, 429: 110 });
    await world.close();
  });

  test("wrong tries from one address do not lock the user out of other addresses (review2 M3)", async () => {
    const world = await World.create(LIMITS);
    await world.customer("Boss Co");
    const email = world.email("Boss Co");
    for (let index = 0; index < 10; index++) {
      expect(
        (await login(world.context.app, email, "wrong-password", "198.51.100.66")).status,
      ).toBe(401);
    }
    // The guesser is stopped, also with the right password.
    expect((await login(world.context.app, email, PASSWORD, "198.51.100.66")).status).toBe(429);
    // The real user at another address logs in.
    expect((await login(world.context.app, email, PASSWORD, "203.0.113.5")).status).toBe(200);
    await world.close();
  });

  test("one email is braked after 100 wrong tries from all addresses together", async () => {
    const world = await World.create({ ...LIMITS, RATE_LIMIT_EMAIL_MAX: "12" });
    await world.customer("Brake Co");
    const email = world.email("Brake Co");
    // 12 wrong tries, each from another address: no address and no pair is full.
    for (let index = 0; index < 12; index++) {
      const status = (
        await login(world.context.app, email, "wrong-password", `198.51.100.${index}`)
      ).status;
      expect(status).toBe(401);
    }
    expect((await login(world.context.app, email, "wrong-password", "198.51.100.200")).status).toBe(
      429,
    );
    await world.close();
  });

  test("a right login, a body that is not valid and a disabled company give the attempt back", async () => {
    const world = await World.create({ RATE_LIMIT_MAX: "3" });
    const admin = await world.admin();
    const off = await world.customer("Off Co");
    await world.customer("Fine Co");
    const before = world.context.limiter.size;
    for (let round = 0; round < 5; round++) {
      expect((await login(world.context.app, world.email("Fine Co"), PASSWORD)).status).toBe(200);
      expect((await login(world.context.app, world.email("Fine Co"), "")).status).toBe(422);
    }
    await world.client.send("PATCH", `${API}/companies/${off.user.companyId}`, admin, {
      disabled: true,
    });
    for (let round = 0; round < 5; round++) {
      expect((await login(world.context.app, world.email("Off Co"), PASSWORD)).status).toBe(403);
    }
    // No key is left of all these calls.
    expect(world.context.limiter.size).toBe(before);
    await world.close();
  });

  test("a call that is refused with 403 or 404 leaves no key (review2 M1, P4)", async () => {
    const world = await World.create({ RATE_LIMIT_MAX: "10", RATE_LIMIT_IP_MAX: "2" });
    const owner = await world.customer("Team Co");
    const mate = { name: "Mate", email: "mate@world.example", password: PASSWORD };
    expect((await world.client.send("POST", `${API}/users`, owner.token, mate)).status).toBe(201);
    const mateToken = (await world.client.login(mate.email)).token;
    const before = world.context.limiter.size;
    const other = { name: "X", email: "x@world.example", password: PASSWORD };
    for (let round = 0; round < 5; round++) {
      // Not the owner: 403, however often. It is never a 429.
      expect((await world.client.send("POST", `${API}/users`, mateToken, other)).status).toBe(403);
    }
    const unknown = { ...other, companyId: crypto.randomUUID() };
    expect((await world.client.send("POST", `${API}/users`, owner.token, unknown)).status).toBe(
      404,
    );
    expect(world.context.limiter.size).toBe(before);
    // The owner is still limited: the answer tells if an email has an account.
    expect((await world.client.send("POST", `${API}/users`, owner.token, mate)).status).toBe(409);
    expect((await world.client.send("POST", `${API}/users`, owner.token, mate)).status).toBe(429);
    await world.close();
  });

  test("wrong current passwords at the same moment cannot pass the limit together", async () => {
    const world = await World.create({ RATE_LIMIT_MAX: "3" });
    const owner = await world.customer("Pass Co");
    const tries = [];
    for (let index = 0; index < 12; index++) {
      tries.push(
        world.client.send("POST", `${API}/users/me/password`, owner.token, {
          currentPassword: `not-my-password-${index}`,
          newPassword: "another-long-password",
        }),
      );
    }
    expect(tally(await Promise.all(tries))).toEqual({ 422: 3, 429: 9 });
    await world.close();
  });

  test("an IPv6 client is its /64 network, an IPv4 client is its address", () => {
    expect(network("203.0.113.9")).toBe("203.0.113.9");
    expect(network("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(network("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(network("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(network("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(network("::1")).toBe("0:0:0:0::/64");
    expect(network("unknown")).toBe("unknown");
  });

  test("many addresses of one IPv6 network share one count", async () => {
    const world = await World.create({ ...LIMITS, RATE_LIMIT_IP_MAX: "3" });
    for (let index = 0; index < 3; index++) {
      const from = `2001:db8:7:7::${index + 1}`;
      expect(
        (await login(world.context.app, `n${index}@v6.example`, "wrong-password", from)).status,
      ).toBe(401);
    }
    const blocked = await login(
      world.context.app,
      "n9@v6.example",
      "wrong-password",
      "2001:db8:7:7:9::9",
    );
    expect(blocked.status).toBe(429);
    // Another network has its own count.
    const other = await login(
      world.context.app,
      "n9@v6.example",
      "wrong-password",
      "2001:db8:7:8::1",
    );
    expect(other.status).toBe(401);
    await world.close();
  });
});
