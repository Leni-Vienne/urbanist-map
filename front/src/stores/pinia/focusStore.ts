import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { createProjectObject } from "@/utils/typeFactories";
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
  // The full Project behind the pinned selection, for the docked detail card. An overlay selection
  // prefers the project joined onto the overlay, falling back to a store lookup by the captured
  // projectId; a project selection reads straight from the store.
  const selectedProject = computed<Project | null>(() => {
    const target = selection.value;
    if (!target) return null;
    const projectStore = useProjectStore();
    if (target.kind === "overlay") {
      const overlay = useOverlayStore().liveOverlays[target.overlayId];
      const joined = overlay?.project;
      if (joined) return createProjectObject(joined);
      return target.projectId ? projectStore.getProjectById(target.projectId) : null;
    }
    return projectStore.getProjectById(target.projectId);
  });
  // A docked detail panel is open whenever something is pinned.
  const detailVisible = computed<boolean>(() => selection.value !== null);

  function setHover(target: FocusTarget | null): void {
    hover.value = target;
  }

  // Pin an overlay, resolving its parent project for the sister highlight. Passing null deselects.
  function selectOverlay(overlayId: string | null): void {
    if (!overlayId) {
      selection.value = null;
      hover.value = null;
      return;
    }
    const overlayStore = useOverlayStore();
    const projectId = overlayStore.liveOverlays[overlayId]?.projectId ?? null;
    selection.value = { kind: "overlay", overlayId, projectId };
    hover.value = null;
  }

  function selectProject(projectId: string): void {
    selection.value = { kind: "project", projectId };
    hover.value = null;
  }

  function clearSelection(): void {
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
    setHover,
    selectOverlay,
    selectProject,
    clearSelection,
  };
});

// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFocusStore, import.meta.hot));
}
