import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { HydratedProject } from "@/types/index";
import { useDetailProject } from "@/composables/project/useDetailProject";
import { openProjectDetail } from "@/services/core/projectSelection";

const originalFetch = globalThis.fetch;

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function select(projectId: string): void {
  useFocusStore().setSelectionTarget({ kind: "project", projectId });
}

function project(id: string): HydratedProject {
  return {
    ...createLocalProject({ id, name: "Example project" }),
    status: "approved",
    slug: id,
    ownerUsername: "author",
    boundaryPath: [],
    render: null,
    mapOverlays: [],
  };
}

function response(data: HydratedProject | null): Response {
  return Response.json([{ result: { data: superjson.serialize(data) } }]);
}

test("changing the primary tag keeps a project draft even when the tag set is unchanged", () => {
  const store = useProjectStore();
  const original = { ...project(crypto.randomUUID()), tags: ["park", "building"] };
  store.upsertHydratedProject(original);
  store.updateProjectDraft(original.id, { tags: ["building", "park"] });
  expect(store.hasProjectDraft(original.id)).toBe(true);
  expect(store.getProjectById(original.id)?.tags).toEqual(["building", "park"]);
});

test.each(["summary", "detail"])(
  "a delayed older %s cannot downgrade the project baseline",
  (source) => {
    const store = useProjectStore();
    const current = { ...project(crypto.randomUUID()), name: "Current name", version: 3 };
    store.upsertHydratedProject(current);
    store.updateProjectDraft(current.id, { description: "Local edit" });
    const older = { ...current, name: "Old name", version: 2 };
    if (source === "summary") store.upsertProjectSummary(older);
    else store.upsertHydratedProject(older);
    expect(store.getPersistedProject(current.id)?.name).toBe("Current name");
    expect(store.getPersistedProject(current.id)?.version).toBe(3);
    expect(store.getProjectById(current.id)?.description).toBe("Local edit");
  },
);

test("selecting an older copy of a project cannot restore its cached gallery", () => {
  const store = useProjectStore();
  const older = project(crypto.randomUUID());
  const mapOverlays = [{ id: "image", filename: "123-image.webp", caption: "Approved image" }];
  store.upsertHydratedProject({ ...older, mapOverlays });
  openProjectDetail(older);
  expect(useFocusStore().selectedProjectId).toBe(older.id);
  expect(store.getHydratedProject(older.id)?.mapOverlays).toEqual(mapOverlays);
});

describe("project detail loading", () => {
  test("a moderation refresh replaces already hydrated fields and keeps local edits", async () => {
    const id = crypto.randomUUID();
    const store = useProjectStore();
    store.upsertHydratedProject(project(id));
    store.updateProjectDraft(id, { description: "Local draft" });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      response({ ...project(id), name: "Approved name", version: 2 }),
    );
    await store.loadProjectDetail(id, true);
    expect(store.getPersistedProject(id)?.name).toBe("Approved name");
    expect(store.getProjectById(id)?.description).toBe("Local draft");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: "New summary", version: 2 },
    { name: "Example project", version: 3 },
  ])(
    "a concurrent summary wins without retaining an old gallery: %o",
    async ({ name, version }) => {
      const id = crypto.randomUUID();
      const store = useProjectStore();
      const original = project(id);
      store.upsertHydratedProject(original);
      const pending = Promise.withResolvers<Response>();
      const started = Promise.withResolvers<void>();
      spyOn(globalThis, "fetch").mockImplementationOnce(
        Object.assign(
          () => {
            started.resolve();
            return pending.promise;
          },
          { preconnect: originalFetch.preconnect },
        ),
      );
      const loading = store.loadProjectDetail(id, true);
      await started.promise;
      store.upsertProjectSummary({
        ...createLocalProject({ id, name }),
        status: "approved",
        version,
      });
      const mapOverlays = [{ id: "image", filename: "123-image.webp", caption: "Fresh image" }];
      pending.resolve(response({ ...original, mapOverlays, version: 2 }));
      await loading;
      expect(store.getHydratedProject(id)?.name).toBe(name);
      expect(store.getHydratedProject(id)?.version).toBe(version);
      expect(store.getHydratedProject(id)?.mapOverlays).toEqual(mapOverlays);
    },
  );

  test("fills detail without overwriting a newer summary received during the request", async () => {
    const id = crypto.randomUUID();
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    spyOn(globalThis, "fetch").mockImplementationOnce(
      Object.assign(
        () => {
          started.resolve();
          return pending.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const store = useProjectStore();
    const request = store.loadProjectDetail(id);
    await started.promise;
    store.upsertProjectSummary({
      ...createLocalProject({ id, name: "New receipt" }),
      status: "pending",
    });
    pending.resolve(response(project(id)));

    expect((await request)?.name).toBe("New receipt");
    expect(store.getHydratedProject(id)?.status).toBe("pending");
  });

  test("a detail request cannot resurrect a deleted project", async () => {
    const id = crypto.randomUUID();
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    spyOn(globalThis, "fetch").mockImplementationOnce(
      Object.assign(
        () => {
          started.resolve();
          return pending.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const store = useProjectStore();
    const request = store.loadProjectDetail(id);
    await started.promise;
    store.removeProject(id);
    pending.resolve(response(project(id)));

    expect(await request).toBeNull();
    expect(store.getProjectById(id)).toBeNull();
  });

  test("distinguishes an unavailable project from a pending request", async () => {
    const id = crypto.randomUUID();
    spyOn(globalThis, "fetch").mockResolvedValue(response(null));
    select(id);
    const request = useProjectStore().loadProjectDetail(id);
    expect(useDetailProject().loadStatus.value).toBe("loading");
    await request;
    expect(useDetailProject().loadStatus.value).toBe("unavailable");
  });

  test("retries a failed request without changing selection", async () => {
    const id = crypto.randomUUID();
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(response(project(id)));
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      select(id);
      await useProjectStore().loadProjectDetail(id);
      expect(useDetailProject().loadStatus.value).toBe("error");
      await useProjectStore().loadProjectDetail(id);
      expect(useDetailProject().loadStatus.value).toBe("ready");
      expect(useFocusStore().selectedProjectId).toBe(id);
      expect(useProjectStore().getHydratedProject(id)?.name).toBe("Example project");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("a late unavailable response cannot overwrite the current project's successful state", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        Object.assign(
          async () => {
            started.resolve(undefined);
            return pending.promise;
          },
          { preconnect: originalFetch.preconnect },
        ),
      )
      .mockResolvedValueOnce(response(project(secondId)));
    select(firstId);
    const first = useProjectStore().loadProjectDetail(firstId);
    await started.promise;
    select(secondId);
    await useProjectStore().loadProjectDetail(secondId);
    pending.resolve(response(null));
    await first;
    expect(useDetailProject().loadStatus.value).toBe("ready");
  });
});

test("resetting the project store prevents a late detail response from replacing the new session's data", async () => {
  const id = crypto.randomUUID();
  const delayed = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<undefined>();
  spyOn(globalThis, "fetch")
    .mockImplementationOnce(
      Object.assign(
        async () => {
          started.resolve(undefined);
          return delayed.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    )
    .mockResolvedValueOnce(response({ ...project(id), name: "New session" }));

  const store = useProjectStore();
  const oldRequest = store.loadProjectDetail(id);
  await started.promise;
  store.clearAllState();
  await store.loadProjectDetail(id);
  delayed.resolve(response({ ...project(id), name: "Old session" }));

  expect(await oldRequest).toBeNull();
  expect(store.getHydratedProject(id)?.name).toBe("New session");
});
