import { expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { useAuthStore } from "./authStore";
import { useUiStore } from "./uiStore";
import { useMapSessionStore } from "./mapSessionStore";
import { useModerationStore } from "./moderationStore";

test("a country round trip invalidates the old moderation request without a mounted map", async () => {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "moderator",
    email: "moderator@example.com",
    username: "Moderator",
    role: "admin",
    moderatedCountries: null,
    emailVerified: true,
  };
  useUiStore().setMode("moderation");
  const store = useModerationStore();
  store.selectedCountryCode = "FRA";

  const started = Promise.withResolvers<undefined>();
  const delayed = Promise.withResolvers<Response>();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        started.resolve(undefined);
        return delayed.promise;
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  try {
    const request = store.fetchPendingSubmissions();
    await started.promise;
    useMapSessionStore().snapshot = {
      mode: "moderation",
      projectIds: ["old-country"],
      overlayIds: [],
    };
    store.selectedCountryCode = "CHE";
    expect(useMapSessionStore().snapshot).toBeNull();
    store.selectedCountryCode = "FRA";
    delayed.resolve(
      Response.json([
        {
          result: {
            data: superjson.serialize({
              projectsById: {},
              overlaysById: {},
              mapOverlays: [],
              changeRequests: [],
            }),
          },
        },
      ]),
    );
    await request;
    expect(store.moderationLoadStatus).toBe("idle");
    expect(useMapSessionStore().snapshot).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});
