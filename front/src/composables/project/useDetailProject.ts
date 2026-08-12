import { computed, watch } from "vue";
import { storeToRefs } from "pinia";

import { useFocusStore } from "@/stores/focusStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { hydrateProjectDetail } from "@/services/core/projectSelection";
import type { OverlayData, Project } from "@/types/index";

/**
 * The project and overlay behind the open detail, resolved for a read-only panel: a project with
 * unsaved local edits shows its approved original. The fields only `getById` returns are fetched
 * once the selection settles.
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

    const stored = projects.value[id];
    if (!stored) return undefined;

    return (stored.isModified ? projectStore.getOriginalProject(id) : null) ?? stored;
  });

  // Summary selections render immediately; the detail-only fields land after.
  function hydrate(id: string | undefined): void {
    const current = project.value;
    if (!id || !current || current.status === null || projectStore.getHydratedProject(id)) return;
    void hydrateProjectDetail(id);
  }

  watch(() => project.value?.id, hydrate, { immediate: true });

  return { project, overlay };
}
