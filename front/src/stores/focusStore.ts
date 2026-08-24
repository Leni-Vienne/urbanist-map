import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import { useProjectStore } from "@/stores/projectStore";
import { useMapStore } from "@/stores/mapStore";
import type { Project } from "@/types/index";

// What is currently emphasized on the map and in the docked detail panel. A project target is a
// standalone/project selection; an overlay target is a selected overlay (its parent project rides
// along for the sister highlight, and is null for a project-less overlay).
type FocusTarget =
  | { kind: "project"; projectId: string }
  | { kind: "overlay"; overlayId: string; projectId: string | null };

function overlayIdOf(target: FocusTarget | null): string | null {
  return target?.kind === "overlay" ? target.overlayId : null;
}

// Single source of truth for hover/selection across the map render layers and the detail panel.
// `hover` is transient (mousemove, sidebar row, DOM marker, shape enter/leave); `selection` is
// pinned by a click. Writing `selection` replaces whatever was there, so overlay/project detail
// mutual exclusivity is free.
export const useFocusStore = defineStore("focus", () => {
  const hover = ref<FocusTarget | null>(null);
  const selection = ref<FocusTarget | null>(null);

  // Emphasized project: the pinned selection first, then the transient hover. Drives the vector
  // tile "selected" feature-state and the GeoJSON shape outline.
  const highlightedProjectId = computed<string | null>(
    () => selection.value?.projectId ?? hover.value?.projectId ?? null,
  );
  // Emphasized overlay footprint (vector feature-state), pinned selection first then hover.
  const highlightedOverlayId = computed<string | null>(
    () => overlayIdOf(selection.value) ?? overlayIdOf(hover.value),
  );
  const selectedOverlayId = computed<string | null>(() => overlayIdOf(selection.value));
  const selectedProjectId = computed<string | null>(() => selection.value?.projectId ?? null);
  // The full Project behind the pinned selection, for the docked detail card.
  const selectedProject = computed<Project | null>(() => {
    const target = selection.value;
    if (!target) return null;
    const projectStore = useProjectStore();
    return target.projectId
      ? projectStore.getMapProjectById(target.projectId, useMapStore().mode)
      : null;
  });
  // A docked detail panel is open whenever something is pinned.
  const detailVisible = computed<boolean>(() => selection.value !== null);

  function setHoverTarget(target: FocusTarget | null): void {
    hover.value = target;
  }

  function setSelectionTarget(target: FocusTarget | null): void {
    selection.value = target;
  }

  function clearAllState(): void {
    hover.value = null;
    selection.value = null;
  }

  return {
    selection,
    highlightedProjectId,
    highlightedOverlayId,
    selectedOverlayId,
    selectedProjectId,
    selectedProject,
    detailVisible,
    setHoverTarget,
    setSelectionTarget,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFocusStore, import.meta.hot));
}
