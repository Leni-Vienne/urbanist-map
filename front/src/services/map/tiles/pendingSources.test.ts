import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { createLocalProject } from "@/utils/typeFactories";
import { clearMapSessionSnapshot, replaceMapSessionSnapshot } from "@/services/map/mapSessionState";

// Map rendering modules read the viewport media query at import; no DOM or map is mounted here.
const originalStorage = globalThis.localStorage;
const stored = new Map<string, string>();
globalThis.localStorage = {
  get length() {
    return stored.size;
  },
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value);
  },
  removeItem: (key) => {
    stored.delete(key);
  },
  clear: () => {
    stored.clear();
  },
  key: (index) => [...stored.keys()][index] ?? null,
};
const originalMatchMedia = globalThis.matchMedia;
globalThis.matchMedia = (media) =>
  Object.assign(new EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
const sources = await import("./basemap");
const { watchPendingProjectSources } = await import("./pendingSources");
globalThis.matchMedia = originalMatchMedia;
globalThis.localStorage = originalStorage;

const points = spyOn(sources, "updatePendingProjectPointsSource");
const shapes = spyOn(sources, "updatePendingProjectShapesSource");
afterAll(() => {
  points.mockRestore();
  shapes.mockRestore();
});
let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  clearMapSessionSnapshot();
  points.mockClear();
  shapes.mockClear();
});

test("source observer follows persisted session changes and catches up after disposal", async () => {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "user",
    email: "user@example.com",
    username: "User",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
  useUiStore().setMode("edit");
  const projectStore = useProjectStore();
  const project = {
    ...createLocalProject({ id: "project", name: "Before", lat: 48, lng: 2 }),
    status: "pending" as const,
  };
  projectStore.upsertProjectSummary(project);
  replaceMapSessionSnapshot({ mode: "edit", projectIds: [project.id], overlayIds: [] });
  stop = watchPendingProjectSources();
  function latestPoints() {
    return points.mock.calls.at(-1)?.[0].features;
  }
  expect(latestPoints()?.[0]?.properties?.name).toBe("Before");

  // Membership stays fixed: a persisted receipt field still needs to refresh the source.
  projectStore.updatePersistedProject(project.id, { name: "After", lng: 3 });
  await nextTick();
  expect(latestPoints()?.[0]).toMatchObject({
    geometry: { type: "Point", coordinates: [3, 48] },
    properties: { name: "After" },
  });

  // An unrelated tile arrival must not send unchanged session GeoJSON again.
  const pointsBeforeTile = points.mock.calls.at(-1)?.[0];
  useOverlayStore().tileOverlays = {};
  await nextTick();
  expect(points.mock.calls.at(-1)?.[0]).toBe(pointsBeforeTile);

  stop();
  projectStore.updatePersistedProject(project.id, { name: "While unmounted" });
  await nextTick();
  expect(latestPoints()?.[0]?.properties?.name).toBe("After");
  stop = watchPendingProjectSources();
  expect(latestPoints()?.[0]?.properties?.name).toBe("While unmounted");

  clearMapSessionSnapshot();
  await nextTick();
  expect(latestPoints()).toEqual([]);
  expect(shapes.mock.calls.at(-1)?.[0].features).toEqual([]);
});
