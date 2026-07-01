import { watch } from "vue";
import { trpc } from "@/client";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { highlightProjectShapes, unhighlightProjectShapes } from "@/services/map/shapes/registry";

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
  const focus = useFocusStore();

  watch(
    () => focus.detailProjectId,
    async (projectId) => {
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
        if (focus.detailProjectId === projectId) writeProjectPath(fresh.slug);
      } catch (error) {
        console.error("Failed to resolve project slug for URL sync:", error);
      }
    },
  );
}

// The selected project (project or overlay selection) is shown in the docked panel's "Selected
// project" card and filtered out of the accordion list. Drop it from the expanded accordion set so
// it returns collapsed (not expanded) when it later falls back into the list on deselection, while
// leaving manually-expanded panels untouched.
function initializeSelectedPanelCleanup() {
  const uiStore = useUiStore();
  const focus = useFocusStore();

  watch(
    () => focus.selectedProjectId,
    (projectId) => {
      if (!projectId) return;
      if (uiStore.activeAccordionPanels.includes(projectId)) {
        uiStore.activeAccordionPanels = uiStore.activeAccordionPanels.filter(
          (id) => id !== projectId,
        );
      }
    },
  );
}

// Drive the GeoJSON project-shape outline (edit/moderation layers) off the focused project: light
// the newly focused project's shapes and revert the previously focused one. The vector tile
// "selected" feature-state is handled separately in projectVectorLayers.
function initializeShapeHighlightWatcher() {
  const focus = useFocusStore();

  watch(
    () => focus.highlightedProjectId,
    (newProjectId, oldProjectId) => {
      if (oldProjectId && oldProjectId !== newProjectId) unhighlightProjectShapes(oldProjectId);
      if (newProjectId) highlightProjectShapes(newProjectId);
    },
  );
}

/**
 * Drives all focus-driven side effects (URL slug sync, accordion cleanup, GeoJSON shape highlight)
 * so click handlers only need to write the focus store. Call once at app boot after Pinia is installed.
 */
export function initializeDetailWatcher() {
  if (isWatcherInitialized) return;
  isWatcherInitialized = true;

  initializeProjectUrlSync();
  initializeSelectedPanelCleanup();
  initializeShapeHighlightWatcher();
}
