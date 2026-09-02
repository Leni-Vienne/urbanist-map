import { computed } from "vue";
import { storeToRefs } from "pinia";

import { useFocusStore } from "@/stores/focusStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import type { OverlayData, Project } from "@/types/index";

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

  const overlay = computed<OverlayData | null>(() => {
    if (selection.value?.kind !== "overlay") return null;
    return liveOverlays.value[selection.value.overlayId] ?? null;
  });

  const project = computed<Project | undefined>(() => {
    const id = focusStore.selectedProjectId;
    if (!id) return undefined;

    return projectStore.getPersistedProject(id) ?? projects.value[id];
  });

  return { project, overlay };
}
