import { initializeEditorTriggers } from "@/services/overlay/editing";
import { initializeMarkerColorTriggers } from "@/services/overlay/markers";
import { initializeShapeRenderTriggers } from "@/services/map/shapes/renderLoop";
import { initializeRenderTriggers } from "@/services/map/viewportRenderLoop";
import { initializeModeTriggers } from "@/services/map/viewportTriggers";

/**
 * The map's module-scoped watchers. Each callee is idempotent, so a MapView remount re-runs this
 * list without duplicating registrations.
 *
 * Order is load-bearing: several of these watch mapStore.mode, and a mode change runs their
 * callbacks in registration order.
 */
export function initializeMapGlobalWatchers(): void {
  initializeEditorTriggers();
  initializeRenderTriggers();
  initializeShapeRenderTriggers();
  initializeMarkerColorTriggers();
  initializeModeTriggers();
}
