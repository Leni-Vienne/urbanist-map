import { watch } from "vue";
import { hydrateProjectDetail } from "@/services/core/projectSelection";
import { closeDetail } from "@/services/overlay/selection";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";

// Permanent slugs never change once assigned, so a session-lifetime cache is always valid and saves
// refetching the slug of a project selected more than once.
const slugCache = new Map<string, string>();

// "/" and "/project/:slug" are the only paths that render the map, so they are the only ones whose
// path describes the open project. On any other route (legal, contact, admin) a selection change
// must not touch the address bar: rewriting the path there would silently replace the destination
// the user navigated to.
function isProjectPathRoute(): boolean {
  const path = globalThis.location.pathname;
  return path === "/" || path.startsWith("/project/");
}

// Rewrite only the path (via history.replaceState), leaving the map-state hash (managed in
// services/core/map.ts) and any query string intact. Bypassing vue-router is intentional: both "/"
// and "/project/:slug" render Home, and the deep-link handler reads the slug only once on mount, so
// swapping the path never remounts Home nor re-triggers that handler (mirroring map.ts's hash writes).
function writeProjectPath(slug: string | null): void {
  if (!isProjectPathRoute()) return;
  const url = new URL(globalThis.location.href);
  const nextPath = slug ? `/project/${encodeURIComponent(slug)}` : "/";
  if (url.pathname === nextPath) return;
  history.replaceState(history.state, "", nextPath + url.search + url.hash);
}

// Keep the address bar in sync with the open project detail so the live URL is a copy-pasteable
// /project/<slug> deep link, and reverts to "/" when nothing is selected. No `immediate`: on a
// deep-link load the URL already carries the slug and the project is selected asynchronously, so
// reacting only to changes avoids wiping the slug back to "/" before it loads.
function watchProjectUrlSync(): void {
  const projectStore = useProjectStore();
  const focus = useFocusStore();

  watch(
    () => focus.selectedProjectId,
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
      const fresh = await hydrateProjectDetail(projectId);
      if (!fresh?.slug) return;
      slugCache.set(projectId, fresh.slug);
      // A fast re-selection may have moved on while awaiting; only write if still the active project.
      if (focus.selectedProjectId === projectId) writeProjectPath(fresh.slug);
    },
  );
}

// The selected project (project or overlay selection) is shown in the docked panel's "Selected
// project" card and filtered out of the accordion list. Drop it from the expanded accordion set so
// it returns collapsed (not expanded) when it later falls back into the list on deselection, while
// leaving manually-expanded panels untouched.
function watchSelectedPanelCleanup(): void {
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

// Moderation reviews pending submissions, a set the other modes never show. Crossing that boundary
// in either direction drops the selection so neither side inherits the other's context; view and
// edit share a world, so a selection carries between them.
function watchModerationSelectionIsolation(): void {
  const uiStore = useUiStore();

  watch(() => uiStore.mode === "moderation", closeDetail);
}

/**
 * Install the app-lifetime focus projections that do not require a MapLibre instance. They live
 * until the page is torn down and are never stopped.
 */
export function startDetailWatcher(): void {
  watchProjectUrlSync();
  watchSelectedPanelCleanup();
  watchModerationSelectionIsolation();
}
