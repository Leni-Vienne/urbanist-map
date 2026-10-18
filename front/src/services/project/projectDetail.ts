import { computed, shallowRef } from "vue";
import { trpc } from "@/client";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { hydratedProjectFromWire } from "@/utils/typeFactories";
import type { HydratedProject } from "@/types/index";

type DetailStatus = "loading" | "ready" | "error" | "unavailable";
const loadState = shallowRef<{ projectId: string; status: DetailStatus } | null>(null);
const pending = new Map<string, Promise<HydratedProject | null>>();

export const projectDetailLoad = computed(() => loadState.value);

function setStatus(projectId: string, status: DetailStatus): void {
  // A slow response may populate the cache, but cannot change another selection's loading state.
  if (useFocusStore().selectedProjectId === projectId) {
    loadState.value = { projectId, status };
  }
}

async function fetchProjectDetail(projectId: string): Promise<HydratedProject | null> {
  const fresh = await trpc.project.getById.query({ id: projectId });
  if (!fresh) return null;
  return useProjectStore().upsertHydratedProject(hydratedProjectFromWire(fresh));
}

/** Load or retry the selected detail, sharing any request already in flight for the same project. */
export async function loadProjectDetail(projectId: string): Promise<HydratedProject | null> {
  const store = useProjectStore();
  const cached = store.getHydratedProject(projectId);
  if (cached || store.getProjectById(projectId)?.status === null) {
    setStatus(projectId, "ready");
    return cached;
  }

  setStatus(projectId, "loading");
  let request = pending.get(projectId);
  if (!request) {
    request = fetchProjectDetail(projectId);
    pending.set(projectId, request);
  }

  try {
    const project = await request;
    setStatus(projectId, project ? "ready" : "unavailable");
    return project;
  } catch (error) {
    console.error("Failed to load project detail:", error);
    setStatus(projectId, "error");
    return null;
  } finally {
    if (pending.get(projectId) === request) pending.delete(projectId);
  }
}
