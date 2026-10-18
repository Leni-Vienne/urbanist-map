import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { HydratedProject } from "@/types/index";
import { loadProjectDetail, projectDetailLoad } from "./projectDetail";

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
    const request = loadProjectDetail(id);
    expect(projectDetailLoad.value).toEqual({ projectId: id, status: "loading" });
    await request;
    expect(projectDetailLoad.value).toEqual({ projectId: id, status: "unavailable" });
  });

  test("retries a failed request without changing selection", async () => {
    const id = crypto.randomUUID();
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(response(project(id)));
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      select(id);
      await loadProjectDetail(id);
      expect(projectDetailLoad.value?.status).toBe("error");
      await loadProjectDetail(id);
      expect(projectDetailLoad.value?.status).toBe("ready");
      expect(useFocusStore().selectedProjectId).toBe(id);
      expect(useProjectStore().getHydratedProject(id)?.name).toBe("Example project");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test.each(["unavailable", "error"] as const)(
    "a late %s response cannot overwrite the current project's successful state",
    async (status) => {
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
      const first = loadProjectDetail(firstId);
      await started.promise;
      select(secondId);
      await loadProjectDetail(secondId);
      const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        if (status === "error") pending.reject(new Error("Network unavailable"));
        else pending.resolve(response(null));
        await first;
      } finally {
        consoleSpy.mockRestore();
      }
      expect(projectDetailLoad.value).toEqual({ projectId: secondId, status: "ready" });
    },
  );

  test("shares concurrent requests and reuses the hydrated cache", async () => {
    const id = crypto.randomUUID();
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response(project(id)));
    select(id);
    await Promise.all([loadProjectDetail(id), loadProjectDetail(id)]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await loadProjectDetail(id);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(projectDetailLoad.value?.status).toBe("ready");
  });
});
