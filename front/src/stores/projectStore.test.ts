import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { HydratedProject } from "@/types/index";
import { useDetailProject } from "@/composables/project/useDetailProject";

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

describe("project detail loading", () => {
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
