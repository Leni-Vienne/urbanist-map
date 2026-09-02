import { watch } from "vue";
import type { Project } from "@/types/index";
import { getMapOrNull, onStyleSwitch, type StyleSwitchPhase } from "@/services/core/map";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { parseShapeCollection } from "@/utils/geojson";
import { clearPreviewShapes, renderPreviewShapes } from "@/services/map/shapes/rendering";

type ProjectShapePreview =
  | { type: "none" }
  | {
      type: "render";
      project: Project;
      geometry: GeoJSON.GeometryCollection | null;
      baselineGeometry: GeoJSON.GeometryCollection | null;
    };

function resolveProjectShapePreview(): ProjectShapePreview {
  const changeRequestStore = useChangeRequestStore();
  const preview = changeRequestStore.previewState;
  if (preview.type !== "project-current" && preview.type !== "project-suggested") {
    return { type: "none" };
  }

  const project = useProjectStore().getMapProjectById(preview.projectId, useUiStore().mode);
  const change = changeRequestStore.getRelevantChangeRequest(preview.changeId);
  if (!project || !change || change.entityId !== preview.projectId) return { type: "none" };

  const baselineGeometry = project.geometry ?? null;
  if (preview.type === "project-current") {
    return { type: "render", project, geometry: baselineGeometry, baselineGeometry: null };
  }

  const geometry = parseShapeCollection(change.newValue);
  if (!geometry) return { type: "none" };
  return { type: "render", project, geometry, baselineGeometry };
}

export function syncProjectShapePreview(): void {
  const mlMap = getMapOrNull();
  if (!mlMap?.getSource("project-sources")) return;

  const preview = resolveProjectShapePreview();
  if (preview.type === "none") {
    clearPreviewShapes();
    return;
  }
  renderPreviewShapes(preview.project, preview.geometry, preview.baselineGeometry);
}

export function watchProjectShapePreview(): () => void {
  const stopPreviewWatch = watch(resolveProjectShapePreview, syncProjectShapePreview);
  const stopStyleSwitchWatch = onStyleSwitch(syncProjectShapePreviewAfterStyleSwitch);

  return function stopProjectShapePreview(): void {
    stopStyleSwitchWatch();
    stopPreviewWatch();
  };
}

function syncProjectShapePreviewAfterStyleSwitch(phase: StyleSwitchPhase): void {
  if (phase === "before") {
    clearPreviewShapes();
    return;
  }
  syncProjectShapePreview();
}
