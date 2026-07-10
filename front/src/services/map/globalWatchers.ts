import { initializeModeTransitions } from "@/services/map/modeTransition";
import { initializeEditorTriggers } from "@/services/overlay/editing";
import { initializeMarkerColorTriggers } from "@/services/overlay/markers";
import { initializeShapeRenderTriggers } from "@/services/map/shapes/renderLoop";
import { initializeRenderTriggers } from "@/services/map/viewportRenderLoop";
import { initializeModeTriggers } from "@/services/map/viewportTriggers";

/**
 * The map's module-scoped watchers. Each callee is idempotent, so a MapView remount re-runs this
 * list without duplicating registrations.
 *
 * Order is load-bearing: initializeModeTransitions creates the sole mapStore.mode watch and must
 * come first, then every onModeTransition hook below runs on a mode change in the order its
 * registrant appears here.
 */
export function initializeMapGlobalWatchers(): void {
  initializeModeTransitions();
  initializeEditorTriggers();
  initializeRenderTriggers();
  initializeShapeRenderTriggers();
  initializeMarkerColorTriggers();
  initializeModeTriggers();
}
