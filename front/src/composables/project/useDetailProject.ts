import { computed } from "vue";
import { storeToRefs } from "pinia";

import { useFocusStore } from "@/stores/focusStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { loadProjectDetail, projectDetailLoad } from "@/services/project/projectDetail";
import type { OverlayObject, Project } from "@/types/index";

/**
 * The project and overlay behind the open detail, resolved for a read-only panel: a project with
 * unsaved local edits shows its approved original.
 */
export function useDetailProject() {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const focusStore = useFocusStore();
  const { liveOverlays } = storeToRefs(overlayStore);
  const { projects } = storeToRefs(projectStore);
  const { selection } = storeToRefs(focusStore);

  const overlay = computed<OverlayObject | null>(() => {
    if (selection.value?.kind !== "overlay") return null;
    return liveOverlays.value[selection.value.overlayId] ?? null;
  });

  const project = computed<Project | undefined>(() => {
    const id = focusStore.selectedProjectId;
    if (!id) return undefined;

    return projectStore.getPersistedProject(id) ?? projects.value[id];
  });

  const loadStatus = computed(() => {
    const id = focusStore.selectedProjectId;
    if (!id) return "unavailable";
    const state = projectDetailLoad.value;
    if (state?.projectId === id) return state.status;
    return projectStore.getHydratedProject(id) || project.value?.status === null
      ? "ready"
      : "loading";
  });

  async function retry(): Promise<void> {
    const id = focusStore.selectedProjectId;
    if (id) await loadProjectDetail(id);
  }

  return { project, overlay, loadStatus, retry };
}
