import { computed, watch } from "vue";
import { storeToRefs } from "pinia";

import { useFocusStore } from "@/stores/focusStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { hydrateProjectDetail } from "@/services/core/projectSelection";
import { createProjectObject } from "@/utils/typeFactories";
import type { OverlayData, Project } from "@/types/index";

/**
 * The project and overlay behind the open detail, resolved for a read-only panel: a project with
 * unsaved local edits shows its approved original, and a project reachable only through the selected
 * overlay is seeded into the store so both selection kinds resolve the same way. The fields only
 * `getById` returns are fetched once the selection settles.
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

  // A vector-tile overlay click carries its parent project inline, and the store may never have seen
  // it. Seeding keeps project resolution a plain store lookup.
  function cacheOverlayProject(current: OverlayData | null): void {
    const joined = current?.project;
    if (!joined || projects.value[joined.id]) return;

    const overlayIds = Object.values(liveOverlays.value)
      .filter((candidate) => candidate.projectId === joined.id)
      .map((candidate) => candidate.id);

    projectStore.addProject(createProjectObject({ ...joined, overlayIds }));
  }

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

  watch(overlay, cacheOverlayProject, { immediate: true });
  watch(() => project.value?.id, hydrate, { immediate: true });

  return { project, overlay };
}
