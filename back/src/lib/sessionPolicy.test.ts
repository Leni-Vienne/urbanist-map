import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { Hono } from "hono";
import { Session, type SessionData, type Store } from "hono-sessions";
import type { AppEnv } from "./types";
import {
  createSessionMiddleware,
  prepareSessionForPersistence,
  SESSION_DURATION_LONG,
  SESSION_DURATION_SHORT,
} from "./sessionPolicy";

const START_TIME = Date.parse("2026-10-14T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
// Each test needs a fresh spy after the previous one restores Date.now.
// oxlint-disable-next-line init-declarations
let dateNowSpy: Mock<typeof Date.now>;

beforeEach(() => {
  dateNowSpy = spyOn(Date, "now");
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

function createTestApp(isDevelopment = false) {
  const rows = new Map<string, { data: SessionData; expiresAt: Date }>();

  function persist(sessionId: string, data: SessionData) {
    const policy = prepareSessionForPersistence(data);
    if (policy.shouldPersist) {
      rows.set(sessionId, { data: structuredClone(data), expiresAt: policy.expiresAt });
    }
  }

  const store: Store = {
    getSessionById(sessionId) {
      if (!sessionId) return null;
      const row = rows.get(sessionId);
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return structuredClone(row.data);
    },
    createSession: persist,
    persistSessionData: persist,
    deleteSession(sessionId) {
      rows.delete(sessionId);
    },
  };

  const app = new Hono<AppEnv>();
  app.use(
    "*",
    createSessionMiddleware(store, "test-cookie-secret-at-least-32-characters", isDevelopment),
  );
  app.post("/login", (c) => {
    const duration =
      c.req.query("rememberMe") === "true" ? SESSION_DURATION_LONG : SESSION_DURATION_SHORT;
    const session = c.get("session");
    session.set("user", {
      id: "test-user",
      email: "user@example.com",
      username: null,
      role: null,
      moderatedCountries: null,
      emailVerified: true,
    });
    session.set("expiresAt", new Date(Date.now() + duration * 1000).toISOString());
    return c.json({ success: true });
  });
  app.get("/check-session", (c) => c.json({ user: c.get("session").get("user") }));
  app.post("/logout", (c) => {
    c.get("session").deleteSession();
    return c.json({ success: true });
  });
  return { app, rows };
}

describe("persistent login", () => {
  test.each([
    [false, SESSION_DURATION_SHORT],
    [true, SESSION_DURATION_LONG],
  ])(
    "rememberMe=%s survives the next day and expires after %i seconds",
    async (rememberMe, duration) => {
      dateNowSpy.mockReturnValue(START_TIME);
      const { app, rows } = createTestApp();
      const response = await app.request(`/login?rememberMe=${rememberMe}`, { method: "POST" });
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`Max-Age=${SESSION_DURATION_LONG}`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=None");
      expect(rows.size).toBe(1);
      expect([...rows.values()][0]?.expiresAt.getTime()).toBe(START_TIME + duration * 1000);

      const cookie = setCookie.split(";")[0] ?? "";
      dateNowSpy.mockReturnValue(START_TIME + DAY_MS);
      const nextDay = await app.request("/check-session", { headers: { Cookie: cookie } });
      const nextDaySession = await nextDay.json();
      expect(nextDaySession.user?.id).toBe("test-user");
      // Visiting again must not extend the login's absolute expiry in the database.
      expect([...rows.values()][0]?.expiresAt.getTime()).toBe(START_TIME + duration * 1000);

      dateNowSpy.mockReturnValue(START_TIME + duration * 1000 + 1);
      const expired = await app.request("/check-session", { headers: { Cookie: cookie } });
      const expiredSession = await expired.json();
      expect(expiredSession.user).toBeNull();
    },
  );

  test("logout invalidates a persistent cookie", async () => {
    dateNowSpy.mockReturnValue(START_TIME);
    const { app, rows } = createTestApp();
    const login = await app.request("/login", { method: "POST" });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    await app.request("/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(rows.size).toBe(0);
    const response = await app.request("/check-session", { headers: { Cookie: cookie } });
    const loggedOutSession = await response.json();
    expect(loggedOutSession.user).toBeNull();
  });

  test("local HTTP development also receives a persistent cookie", async () => {
    dateNowSpy.mockReturnValue(START_TIME);
    const { app } = createTestApp(true);
    const response = await app.request("/login", { method: "POST" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`Max-Age=${SESSION_DURATION_LONG}`);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });
});

describe("session persistence", () => {
  test("anonymous sessions are skipped, OSM state is temporary, and cleared state is skipped", () => {
    const session = new Session();
    expect(prepareSessionForPersistence(session.getCache(), START_TIME).shouldPersist).toBe(false);
    session.set("osmOauth", { state: "test-state", rememberMe: true });
    expect(prepareSessionForPersistence(session.getCache(), START_TIME)).toEqual({
      shouldPersist: true,
      expiresAt: new Date(START_TIME + 10 * 60 * 1000),
    });
    session.set("osmOauth", undefined);
    expect(prepareSessionForPersistence(session.getCache(), START_TIME).shouldPersist).toBe(false);
  });

  test.each([undefined, "invalid date"])(
    "falls back to 30 days for a missing or invalid expiry: %s",
    (expiry) => {
      const session = new Session();
      session.set("user", { id: "test-user" });
      session.set("expiresAt", expiry);
      expect(prepareSessionForPersistence(session.getCache(), START_TIME).expiresAt.getTime()).toBe(
        START_TIME + SESSION_DURATION_LONG * 1000,
      );
    },
  );
});
