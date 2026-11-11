import { watch } from "vue";
import { getMapOrNull, onStyleSwitch, type StyleSwitchPhase } from "@/services/core/map";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { clearPreviewShapes, renderPreviewShapes } from "@/services/map/shapes/rendering";

function resolveProjectShapePreview() {
  const preview = useChangeRequestStore().previewState;
  if (preview?.change.entityType !== "project" || preview.change.fieldName !== "geometry")
    return null;

  const project = useProjectStore().getMapProjectById(preview.change.entityId, useUiStore().mode);
  if (!project) return null;

  const baselineGeometry = project.geometry ?? null;
  if (preview.side === "current") {
    return { project, geometry: baselineGeometry, baselineGeometry: null };
  }

  const geometry = preview.change.newValue;
  if (!geometry || geometry.geometries.length === 0) return null;
  return { project, geometry, baselineGeometry };
}

export function syncProjectShapePreview(): void {
  const mlMap = getMapOrNull();
  if (!mlMap?.getSource("project-sources")) return;

  const preview = resolveProjectShapePreview();
  if (!preview) {
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
