import maplibregl from "maplibre-gl";
import { watch } from "vue";
import type { Project } from "@/types/index";
import { map } from "@/services/core/map";
import {
  createStandaloneProjectMarkerElement,
  updateStandaloneMarkerColor,
} from "@/services/map/markers";
import { shouldShowStandaloneProject } from "@/services/overlay/statusFilters";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { clearAllProjectShapes } from "@/services/map/shapeRendering";
import {
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeLayerRegistry";
// t() is imported directly since useI18n() is only available inside component setup().
import { t } from "@/locales";

const standaloneProjectMarkerMap = new Map<string, maplibregl.Marker>();

// Project IDs whose marker is currently attached to the map (visibility tracking).
const markersOnMap = new Set<string>();

// Track the currently selected standalone project marker (for opacity control)
let selectedStandaloneProjectMarker: maplibregl.Marker | null = null;

/** Returns the standalone project marker for a given project ID. */
export function getStandaloneProjectMarkerByProjectId(
  projectId: string,
): maplibregl.Marker | undefined {
  return standaloneProjectMarkerMap.get(projectId);
}

/** Scale up a standalone project marker on hover. */
export function highlightStandaloneProjectMarker(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;
  const el = marker.getElement();
  const svg = el.querySelector("svg");
  if (svg) {
    svg.style.transformOrigin = "center bottom";
    svg.style.transition = "transform 0.15s ease";
    svg.style.transform = "scale(1.5)";
  }
  el.style.zIndex = "1000";
}

/** Reset a standalone project marker scale after hover leave. */
export function unhighlightStandaloneProjectMarker(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;
  const el = marker.getElement();
  const svg = el.querySelector("svg");
  if (svg) {
    svg.style.transform = "";
  }
  el.style.zIndex = "";
}

/** Remove the standalone project marker for a given project (called when the first overlay is added). */
export function removeStandaloneProjectMarkerForProject(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;

  const uiStore = useUiStore();
  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
    uiStore.closeProjectInfoPopup();
  }

  marker.remove();
  markersOnMap.delete(projectId);
  standaloneProjectMarkerMap.delete(projectId);
}

/** Remove all standalone project markers from the map. */
export function clearAllStandaloneProjectMarkers(): void {
  for (const marker of standaloneProjectMarkerMap.values()) {
    marker.remove();
  }

  standaloneProjectMarkerMap.clear();
  markersOnMap.clear();
  selectedStandaloneProjectMarker = null;
  clearAllProjectShapes();
}

/** Show/hide standalone markers based on the current completion filters. */
export function refreshAllStandaloneMarkers(): void {
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  for (const [projectId, marker] of standaloneProjectMarkerMap.entries()) {
    const project = projectStore.projects[projectId];
    if (!project) continue;

    const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

    if (shouldBeVisible && !markersOnMap.has(projectId)) {
      marker.addTo(map.value);
      markersOnMap.add(projectId);
    } else if (!shouldBeVisible && markersOnMap.has(projectId)) {
      marker.remove();
      markersOnMap.delete(projectId);
    }
  }
}

/**
 * Set or clear the tooltip (title attribute) on a standalone marker.
 * Tooltips are only shown in edit and moderation modes.
 */
export function updateStandaloneProjectMarkerTooltip(
  marker: maplibregl.Marker,
  project: Project,
  mode: "view" | "edit" | "moderation",
): void {
  const el = marker.getElement();

  if (mode === "view") {
    el.removeAttribute("title");
    return;
  }

  let tooltipText = "";
  let modifierText = "";

  if (mode === "moderation") {
    // Standalone markers in moderation come only from getProjectsInViewport (pending or
    // approved-with-pending-content), so status is always "pending" or "approved" here.
    tooltipText =
      project.status === "approved"
        ? t("common.approved")
        : t("markerTooltip.project.pendingApproval");
  } else if (mode === "edit") {
    const hasBeenModified = project.isModified ?? false;
    const status = project.status;

    if (status === "pending") {
      tooltipText = t("markerTooltip.project.pendingApproval");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.project.modified");
      }
    } else if (status === "approved") {
      tooltipText = t("common.approved");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.project.modified");
      }
    } else if (status === "rejected") {
      tooltipText = t("markerTooltip.project.rejected");
    } else if (hasBeenModified) {
      tooltipText = t("markerTooltip.project.localProject");
    } else {
      tooltipText = t("markerTooltip.project.newProject");
    }
  }

  el.title = modifierText ? `${tooltipText} (${modifierText})` : tooltipText;
}

/** Dim all standalone markers except the selected one. */
export function updateStandaloneProjectMarkerOpacities(selectedMarker: maplibregl.Marker | null) {
  selectedStandaloneProjectMarker = selectedMarker;

  for (const marker of standaloneProjectMarkerMap.values()) {
    const opacity =
      selectedMarker && marker === selectedMarker
        ? MARKER_OPACITY.standalone.hover
        : MARKER_OPACITY.standalone.default;
    marker.getElement().style.opacity = String(opacity);
  }
}

/** Add a standalone project marker (called when the last overlay of a project is removed). */
export function addStandaloneProjectMarkerForProject(project: Project): void {
  if (typeof project.lat !== "number" || typeof project.lng !== "number") return;

  if (standaloneProjectMarkerMap.has(project.id)) return;

  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

  // Store project in projectStore so color updates can find it later
  // (viewport-loaded markers aren't always loaded via the city fetch path).
  const projectStore = useProjectStore();
  if (!projectStore.projects[project.id]) {
    projectStore.projects = {
      ...projectStore.projects,
      [project.id]: project,
    };
  }

  const element = createStandaloneProjectMarkerElement(markerColor);
  element.style.opacity = String(MARKER_OPACITY.standalone.default);

  const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([
    project.lng,
    project.lat,
  ]);

  // Store marker before adding to map so refreshAllStandaloneMarkers can find it.
  standaloneProjectMarkerMap.set(project.id, marker);

  if (shouldBeVisible) {
    marker.addTo(map.value);
    markersOnMap.add(project.id);
  }

  // stopPropagation keeps the marker click off the canvas, so the map-level deselect /
  // popup-close handlers never fire for it.
  element.addEventListener("dblclick", (e) => {
    e.stopPropagation();
  });

  element.addEventListener("mouseenter", () => {
    element.style.opacity = String(MARKER_OPACITY.standalone.hover);
    highlightProjectShapes(project.id);
  });

  element.addEventListener("mouseleave", () => {
    element.style.opacity =
      selectedStandaloneProjectMarker === marker
        ? String(MARKER_OPACITY.standalone.hover)
        : String(MARKER_OPACITY.standalone.default);
    const uiStore = useUiStore();
    const popupIsOpenForThis =
      uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id;
    if (!popupIsOpenForThis) {
      unhighlightProjectShapes(project.id);
    }
  });

  updateStandaloneProjectMarkerTooltip(marker, project, mapStore.mode);

  element.addEventListener("click", (e) => {
    e.stopPropagation();
    const uiStore = useUiStore();

    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      return;
    }

    uiStore.openProjectInfoPopup(project.id, project);
  });
}

/** Returns the internal standalone marker map. */
export function getStandaloneProjectMarkerMap(): Map<string, maplibregl.Marker> {
  return standaloneProjectMarkerMap;
}

/** Update the icon color of a standalone project marker. */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  updateStandaloneMarkerColor(marker, markerColor);
}

/** Reset all standalone marker opacities (e.g. after the project detail closes). */
export function closeProjectPopupAndResetMarkers() {
  updateStandaloneProjectMarkerOpacities(null);
}

// On mode switch: clear all standalone markers, and on entering edit mode re-add markers
// for the user's local (unsaved) and own-pending projects.
let standaloneMarkerModeWatcherInitialized = false;
export function initializeStandaloneMarkerModeWatcher() {
  // MapView can remount; the watch below ties to global state so once is enough.
  if (standaloneMarkerModeWatcherInitialized) return;
  standaloneMarkerModeWatcherInitialized = true;

  const mapStore = useMapStore();
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  watch(
    () => mapStore.mode,
    (newMode) => {
      clearAllStandaloneProjectMarkers();
      if (newMode !== "edit") return;

      const userId = authStore.user?.id;
      const userProjects = Object.values(projectStore.projects).filter(
        (p) =>
          typeof p.lat === "number" &&
          typeof p.lng === "number" &&
          (p.status === null || (p.status === "pending" && p.ownerId === userId)),
      );
      for (const project of userProjects) {
        addStandaloneProjectMarkerForProject(project);
      }
    },
  );
}
