import L, { type LatLng } from "leaflet";
import { computed } from "vue";
import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  getOverlayBounds,
} from "@/composables/overlay/useOverlayMarkers";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { loadCityProjects } from "@/composables/map/useCityMarkers";
import { prepareCountryContext } from "@/composables/map/useCountryMarkers";
import { switchMode } from "@/composables/overlay/useOverlayModes";
import { mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { prepareCrossCountryFlight } from "@/composables/map/useTileLayers";
import type { PendingChangeRequest } from "../../types/api";
import type { OverlayForModeration, OverlayObject } from "@/types/index";
import { previewState, clearChangeRequestPreview } from "./changeRequestPreviewState";

// AI : Composable to handle change request position preview
// AI : Combines state management + navigation logic for previewing change request positions

interface PreviewGeometryOptions {
  change: PendingChangeRequest;
  overlayForModeration: OverlayForModeration;
  geometryValue: unknown;
  type: "old" | "new";
}

// AI : Type guard for coordinate object
function isCoordinate(value: unknown): value is { lat: number; lng: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "lat" in value &&
    "lng" in value &&
    typeof value.lat === "number" &&
    typeof value.lng === "number"
  );
}

export function useChangeRequestPreview() {
  const toast = useToast();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : State management (from usePositionPreview)
  const hasActivePreview = computed(() => previewState.value.type !== "none");

  function isPreviewingChange(changeId: string): boolean {
    const state = previewState.value;
    if (state.type === "none") return false;
    return state.changeId === changeId;
  }

  function getPreviewType(changeId: string): "current" | "suggested" | null {
    const state = previewState.value;
    if (state.type === "none" || state.changeId !== changeId) return null;
    return state.type === "current" ? "current" : "suggested";
  }

  function clearPreview(): void {
    clearChangeRequestPreview();
  }

  // AI : Type guard for coordinate array
  function isCoordinateArray(value: unknown): value is { lat: number; lng: number }[] {
    return Array.isArray(value) && value.length > 0 && value.every(isCoordinate);
  }

  // AI : Parse geometry value into corner coordinates
  // AI : Handles both single coordinate and coordinate arrays from JSONB fields
  function parseGeometry(geometryValue: unknown): { lat: number; lng: number }[] {
    if (!geometryValue || typeof geometryValue !== "object") {
      return [];
    }

    // AI : Single coordinate (centerCoordinate, centroid)
    if (isCoordinate(geometryValue)) {
      return [geometryValue];
    }

    // AI : Array of coordinates (corners)
    if (isCoordinateArray(geometryValue)) {
      return geometryValue;
    }

    return [];
  }

  // AI : Ensure overlay is loaded into the map (handles navigation if needed)
  async function ensureOverlayLoaded(
    overlayForModeration: OverlayForModeration,
    targetCorners: LatLng[],
  ): Promise<boolean> {
    let overlayObject = overlayStore.overlays[overlayForModeration.id];

    // AI : Already loaded, nothing to do
    if (overlayObject?.overlay != null) {
      return true;
    }

    // AI : Need to load - validate we have required data
    if (!overlayForModeration.cityId || !overlayForModeration.countryCode || !map.value) {
      toast.add({
        severity: "error",
        summary: t("overlay.missingData"),
        detail: t("overlay.missingCityOrCountry"),
        life: 3000,
      });
      return false;
    }

    // AI : Step 1: Switch to edit mode if needed (pending overlays only visible in edit mode)
    const needsEditMode = overlayStore.mode === "view" && overlayForModeration.status === "pending";
    if (needsEditMode) {
      await switchMode("edit");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // AI : Step 2: Prepare for cross-country flight (switches to esri if needed)
    const switchToCountryLayer = prepareCrossCountryFlight(overlayForModeration.countryCode);

    // AI : Step 3: Prepare country context (clear map, load cities, add markers)
    await prepareCountryContext(overlayForModeration.countryCode);

    // AI : Step 4: Navigate to overlay position
    const targetBounds = L.latLngBounds(targetCorners);
    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // AI : Wait for navigation to complete and switch tile layer if cross-country
    await new Promise<void>((resolve) => {
      if (map.value != null) {
        map.value.once("moveend", () => {
          if (switchToCountryLayer) {
            switchToCountryLayer();
          }
          setTimeout(resolve, 100);
        });
      } else {
        resolve();
      }
    });

    // AI : Step 5: Load city projects (this renders overlays)
    await loadCityProjects(
      overlayForModeration.cityId,
      overlayForModeration.cityName ?? "City",
      true, // AI : Force full load regardless of zoom
      overlayForModeration.countryCode,
    );

    // AI : Wait for overlays to render
    await new Promise((resolve) => setTimeout(resolve, 400));

    // AI : Check if overlay loaded successfully
    overlayObject = overlayStore.overlays[overlayForModeration.id];

    if (!overlayObject) {
      // AI : Debug logging for troubleshooting
      console.error("[useChangeRequestPreview] Overlay not loaded after city projects loaded", {
        overlayId: overlayForModeration.id,
        availableOverlays: Object.keys(overlayStore.overlays),
        cityOverlays: mapStore.currentCityOverlays.map((o) => ({ id: o.id, status: o.status })),
        mode: overlayStore.mode,
        status: overlayForModeration.status,
      });

      // AI : One more attempt with longer wait
      const overlayInMapStore = mapStore.currentCityOverlays.find(
        (o) => o.id === overlayForModeration.id,
      );
      if (overlayInMapStore) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        overlayObject = overlayStore.overlays[overlayForModeration.id];
      }
    }

    if (overlayObject?.overlay == null) {
      toast.add({
        severity: "error",
        summary: t("overlay.loadFailed"),
        detail: t("overlay.couldNotLoadOverlay"),
        life: 3000,
      });
      return false;
    }

    return true;
  }

  // AI : Navigate to position with smooth bounds transition
  function navigateToPosition(
    targetLatLngs: L.LatLng[],
    previousBounds: L.LatLngBounds | null,
    overlayId: string,
  ): void {
    if (!map.value) return;

    const newBounds = L.latLngBounds(targetLatLngs);

    // AI : If we have previous bounds, create combined bounds to show both positions
    // AI : This creates a smooth unzoom effect instead of jarring camera jump
    const targetBounds = previousBounds ? newBounds.extend(previousBounds) : newBounds;

    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // AI : Select overlay after flyTo completes
    map.value.once("moveend", () => {
      selectOverlay(overlayId);
    });
  }

  // AI : Get target corners based on preview type
  function getTargetCorners(overlayObject: OverlayObject, type: "old" | "new"): L.LatLng[] | null {
    if (type === "new") {
      // AI : Show suggested position
      if (!overlayObject.suggestedCorners || overlayObject.suggestedCorners.length !== 4) {
        console.warn("No suggested corners available for overlay", overlayObject.id);
        return null;
      }
      return overlayObject.suggestedCorners.map((c: { lat: number; lng: number }) =>
        L.latLng(c.lat, c.lng),
      );
    } else {
      // AI : Show approved position (always in corners field)
      if (overlayObject.corners.length !== 4) {
        return null;
      }
      return overlayObject.corners.map((c: { lat: number; lng: number }) => L.latLng(c.lat, c.lng));
    }
  }

  // AI : Apply position preview to loaded overlay
  function applyPositionPreview(
    overlayId: string,
    type: "old" | "new",
    wasAlreadyLoaded: boolean,
  ): void {
    const overlayObject = overlayStore.overlays[overlayId];
    if (!overlayObject?.overlay) {
      return;
    }

    // AI : Capture the current bounds BEFORE switching positions
    // AI : This allows us to show both old and new positions after the switch
    let previousBounds: L.LatLngBounds | null = null;
    if (wasAlreadyLoaded) {
      previousBounds = getOverlayBounds(overlayObject);
    }

    // AI : Get target corners based on type
    const targetLatLngs = getTargetCorners(overlayObject, type);
    if (!targetLatLngs) {
      return;
    }

    // AI : Update overlay state based on type
    if (type === "new") {
      overlayObject.hasPendingChanges = true;
      overlayObject.isViewingApprovedPosition = false;
    } else {
      overlayObject.isViewingApprovedPosition = true;
    }

    // AI : Apply the position change
    overlayObject.overlay.setCorners(targetLatLngs);
    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);

    // AI : Always navigate to the final position to ensure camera is centered correctly
    // AI : Force navigation even if position didn't change to provide user feedback
    // AI : If overlay was already loaded, we show both old and new positions with combined bounds
    // AI : If overlay was just loaded, we still navigate to ensure camera is at the correct position
    navigateToPosition(targetLatLngs, previousBounds, overlayId);
  }

  // AI : Main function to preview geometry change
  async function previewGeometry(options: PreviewGeometryOptions): Promise<void> {
    const { change, overlayForModeration, geometryValue, type } = options;

    try {
      // AI : Step 1: Parse geometry
      const corners = parseGeometry(geometryValue);

      if (corners.length === 0) {
        toast.add({
          severity: "warn",
          summary: t("overlay.invalidCoordinates"),
          detail: t("overlay.couldNotParseCoordinates"),
          life: 3000,
        });
        return;
      }

      const latLngs = corners.map((c) => L.latLng(c.lat, c.lng));

      // AI : Step 2: Check if overlay is already loaded
      const wasAlreadyLoaded = Boolean(overlayStore.overlays[change.entityId]?.overlay);

      // AI : Step 3: Ensure overlay is loaded (handles navigation if needed)
      const loaded = await ensureOverlayLoaded(overlayForModeration, latLngs);
      if (!loaded) {
        return;
      }

      // AI : Step 4: Apply position preview
      applyPositionPreview(change.entityId, type, wasAlreadyLoaded);

      // AI : Step 5: Update state machine
      if (type === "new") {
        previewState.value = {
          type: "suggested",
          changeId: change.id,
          overlayId: change.entityId,
          corners,
        };
      } else {
        previewState.value = {
          type: "current",
          changeId: change.id,
          overlayId: change.entityId,
        };
      }
    } catch (error) {
      console.error("[useChangeRequestPreview] Failed to preview geometry:", error);
      toast.add({
        severity: "error",
        summary: t("overlay.previewFailed"),
        detail: t("overlay.couldNotPreviewCoordinates"),
        life: 3000,
      });
    }
  }

  return {
    // AI : State queries
    previewState,
    hasActivePreview,
    isPreviewingChange,
    getPreviewType,
    clearPreview,
    // AI : Actions
    previewGeometry,
    parseGeometry,
  };
}
