import { nextTick } from "vue";
import { useMapStore } from "@/stores/mapStore";

import { t } from "@/locales";
import { clearAllMapContent } from "@/services/overlay/lifecycle";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { renderPreviewShapes, computeShapeBounds } from "@/services/map/shapes/rendering";
import { selectProject } from "@/services/map/projectSelection";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import type { PendingChangeRequest, Project } from "@/types/index";
import { toastWarn } from "@/services/core/toast";

interface PreviewShapesOptions {
  change: PendingChangeRequest;
  project: Project;
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
  // oxlint-disable-next-line no-unsafe-type-assertion
  return gc as GeoJSON.GeometryCollection;
}

export async function previewShapes(options: PreviewShapesOptions): Promise<void> {
  const { change, project, geometryValue, type } = options;
  const mapStore = useMapStore();

  const geometry = parseGeometryCollection(geometryValue);
  if (!geometry) {
    toastWarn(t("shapes.noShapesToPreview"));
    return;
  }

  const bounds = computeShapeBounds(geometry.geometries);
  if (!bounds) return;

  // Navigate to the correct country context if not already there
  if (project.countryCode && mapStore.selectedCountryCode !== project.countryCode) {
    clearAllMapContent();
    mapStore.setSelectedCountryCode(project.countryCode);
    await nextTick();
  }

  const newGeom = type === "new" ? geometry : (project.geometry ?? null);
  const oldGeom = type === "new" ? (project.geometry ?? null) : null;

  renderPreviewShapes(project, newGeom, oldGeom, () => {
    selectProject(project);
  });

  mobileAwareFlyToBounds(bounds);

  // The effective preview derives from intent × selection: selecting the project (which replaces
  // any overlay selection) is what puts the intent in effect.
  selectProject(project);
  useChangeRequestStore().previewIntent = {
    changeId: change.id,
    side: type === "new" ? "suggested" : "current",
  };
}
