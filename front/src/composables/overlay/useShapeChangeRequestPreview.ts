import L from "leaflet";
import { nextTick } from "vue";
import { map } from "@/services/core/map";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { clearAllMapContent } from "@/services/overlay/overlayLifecycle";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { renderPreviewShapes } from "@/services/map/shapeRendering";
import { createProjectInfoTeleportTargetAtLatLng } from "@/services/map/projectPopupTeleport";
import { requestScrollTo } from "@/services/layout/accordionState";
import { previewState } from "@/services/overlay/changeRequestPreviewState";
import { forEachPosition } from "@/utils/geojson";
import type { PendingChangeRequest, ProjectForModeration } from "@/types/index";

interface PreviewShapesOptions {
  change: PendingChangeRequest;
  project: ProjectForModeration;
  geometryValue: unknown;
  type: "old" | "new";
}

function parseGeometryCollection(value: unknown): GeoJSON.GeometryCollection | null {
  if (!value || typeof value !== "object") return null;
  const gc = value as { type?: string; geometries?: unknown[] };
  if (
    gc.type !== "GeometryCollection" ||
    !Array.isArray(gc.geometries) ||
    gc.geometries.length === 0
  )
    return null;
  return gc as GeoJSON.GeometryCollection;
}

function computeBounds(geometry: GeoJSON.GeometryCollection): L.LatLngBounds | null {
  const latLngs: L.LatLng[] = [];
  for (const geom of geometry.geometries) {
    forEachPosition(geom, (lng, lat) => latLngs.push(L.latLng(lat, lng)));
  }
  if (latLngs.length === 0) return null;
  return L.latLngBounds(latLngs);
}

export function useShapeChangeRequestPreview() {
  const toast = useToast();
  const mapStore = useMapStore();

  async function previewShapes(options: PreviewShapesOptions): Promise<void> {
    const { change, project, geometryValue, type } = options;

    const geometry = parseGeometryCollection(geometryValue);
    if (!geometry) {
      toast.add({
        severity: "warn",
        summary: t("shapes.noShapesToPreview"),
        life: 3000,
      });
      return;
    }

    const bounds = computeBounds(geometry);
    if (!bounds) return;

    // Navigate to the correct country context if not already there
    if (project.countryCode && mapStore.selectedCountryCode !== project.countryCode) {
      clearAllMapContent();
      mapStore.selectedCountryCode = project.countryCode;
      await nextTick();
    }

    const uiStore = useUiStore();

    renderPreviewShapes(
      geometry,
      map.value,
      type === "new" ? "suggested" : "current",
      project.id,
      (latlng) => {
        createProjectInfoTeleportTargetAtLatLng(latlng);
        uiStore.openProjectInfoPopup(project.id, project);
        requestScrollTo("project", project.id);
      },
    );

    mobileAwareFlyToBounds(bounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });

    previewState.value =
      type === "new"
        ? { type: "project-suggested", changeId: change.id, projectId: project.id }
        : { type: "project-current", changeId: change.id, projectId: project.id };
  }

  return { previewShapes };
}
