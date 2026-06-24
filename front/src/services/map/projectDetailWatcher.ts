import { watch } from "vue";
import { trpc } from "@/client";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { unhighlightProjectShapes } from "@/services/map/shapeLayerRegistry";
import { selectOverlay } from "@/services/overlay/selection";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { requestScrollTo } from "@/services/layout/accordionState";
import { useActiveDetail } from "@/composables/project/useActiveDetail";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerOpacities,
} from "@/services/map/standaloneProjectMarkers";

let isWatcherInitialized = false;

// Permanent slugs never change once assigned, so a session-lifetime cache is always valid and saves
// refetching the slug of a project selected more than once.
const slugCache = new Map<string, string>();

// Rewrite only the path (via history.replaceState), leaving the map-state hash (managed in
// services/core/map.ts) and any query string intact. Bypassing vue-router is intentional: both "/"
// and "/project/:slug" render Home, and the deep-link handler reads the slug only once on mount, so
// swapping the path never remounts Home nor re-triggers that handler (mirroring map.ts's hash writes).
function writeProjectPath(slug: string | null): void {
  const url = new URL(globalThis.location.href);
  const nextPath = slug ? `/project/${encodeURIComponent(slug)}` : "/";
  if (url.pathname === nextPath) return;
  history.replaceState(history.state, "", nextPath + url.search + url.hash);
}

// Keep the address bar in sync with the open project detail so the live URL is a copy-pasteable
// /project/<slug> deep link, and reverts to "/" when nothing is selected. No `immediate`: on a
// deep-link load the URL already carries the slug and the project is selected asynchronously, so
// reacting only to changes avoids wiping the slug back to "/" before it loads.
function initializeProjectUrlSync() {
  const projectStore = useProjectStore();
  const { projectId: activeProjectId } = useActiveDetail();

  watch(activeProjectId, async (projectId) => {
    if (!projectId) {
      writeProjectPath(null);
      return;
    }

    const knownSlug = projectStore.projects[projectId]?.slug ?? slugCache.get(projectId);
    if (knownSlug) {
      slugCache.set(projectId, knownSlug);
      writeProjectPath(knownSlug);
      return;
    }

    // Slug wasn't loaded with the project (e.g. it came from the viewport payload). Resolve it once.
    try {
      const fresh = await trpc.project.getById.query({ id: projectId });
      if (!fresh?.slug) return;
      slugCache.set(projectId, fresh.slug);
      // A fast re-selection may have moved on while awaiting; only write if still the active project.
      if (activeProjectId.value === projectId) writeProjectPath(fresh.slug);
    } catch (error) {
      console.error("Failed to resolve project slug for URL sync:", error);
    }
  });
}

/**
 * Drives all detail-state-driven side effects (marker opacity, vector hover highlight,
 * accordion scroll, overlay detail hide, deselect) so click handlers only need to toggle
 * the detail state. Call once at app boot after Pinia is installed.
 */
export function initializeDetailWatcher() {
  if (isWatcherInitialized) return;
  isWatcherInitialized = true;

  initializeProjectUrlSync();

  watch(
    () => {
      const uiStore = useUiStore();
      return uiStore.projectDetail.visible ? uiStore.projectDetail.projectId : null;
    },
    (newProjectId, oldProjectId) => {
      if (newProjectId === oldProjectId) return;

      const overlayStore = useOverlayStore();
      const mapStore = useMapStore();

      if (oldProjectId && oldProjectId !== newProjectId) {
        unhighlightProjectShapes(oldProjectId);
      }

      if (!newProjectId) {
        updateStandaloneProjectMarkerOpacities(null);
        setExternalHover(null);
        return;
      }

      const marker = getStandaloneProjectMarkerByProjectId(newProjectId) ?? null;
      updateStandaloneProjectMarkerOpacities(marker);

      // Pin the vector tile highlight in view mode (overlay-only projects only render via tiles).
      if (mapStore.mode === "view") {
        setExternalHover(newProjectId);
      }

      requestScrollTo("project", newProjectId);

      if (overlayStore.overlayDetailVisible) overlayStore.closeOverlayDetail();
      if (overlayStore.idSelectedOverlay) selectOverlay(null);
    },
  );
}
