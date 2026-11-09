import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "./authStore";
import type { AuthUser } from "@shared/types/auth";

const originalFetch = globalThis.fetch;
const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  username: "User",
  role: "user",
  moderatedCountries: [],
  emailVerified: true,
};
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => mock.restore());

test("logout follows a pending login and protected navigation waits for the final session", async () => {
  const loginResponse = Promise.withResolvers<Response>();
  const loginEntered = Promise.withResolvers<void>();
  const logoutResponse = Promise.withResolvers<Response>();
  const logoutEntered = Promise.withResolvers<void>();
  const fetchSpy = spyOn(globalThis, "fetch")
    .mockImplementationOnce(
      Object.assign(async () => {
        loginEntered.resolve();
        return loginResponse.promise;
      }, originalFetch),
    )
    .mockImplementationOnce(
      Object.assign(async () => {
        logoutEntered.resolve();
        return logoutResponse.promise;
      }, originalFetch),
    )
    .mockImplementation(
      Object.assign(async () => Response.json({ user: null, infoMessage: null }), originalFetch),
    );
  const auth = useAuthStore();
  const login = auth.signIn(user.email, "password");
  await loginEntered.promise;
  const logout = auth.signOut();
  const initialization = auth.initialize();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  loginResponse.resolve(Response.json({ token: "fixture", user }));
  await logoutEntered.promise;
  expect((await login).success).toBe(false);
  let initialized = false;
  void initialization.then(() => {
    initialized = true;
  });
  await Promise.resolve();
  expect(initialized).toBe(false);
  logoutResponse.resolve(Response.json({ success: true }));
  await Promise.all([logout, initialization]);
  expect(auth.user).toBeNull();
  expect(String(fetchSpy.mock.calls[1]?.[0])).toEndWith("/api/auth/sign-out");
});

test("a verification response superseded by logout cannot restore the user", async () => {
  const response = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<void>();
  spyOn(globalThis, "fetch")
    .mockImplementationOnce(
      Object.assign(async () => {
        entered.resolve();
        return response.promise;
      }, originalFetch),
    )
    .mockImplementation(
      Object.assign(async () => Response.json({ user: null, infoMessage: null }), originalFetch),
    );
  const auth = useAuthStore();
  const verification = auth.verifyEmail("old-token");
  await entered.promise;
  const logout = auth.signOut();
  response.resolve(Response.json({ status: true, user }));
  expect((await verification).success).toBe(false);
  await logout;
  expect(auth.user).toBeNull();
});
