import L, { type LatLng } from "leaflet";
import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  getOverlayBounds,
} from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { selectCity } from "@/services/navigation/locationNavigation";
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { switchMode } from "@/services/overlay/modeSwitching";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import type { OverlayForModeration, OverlayObject, PendingChangeRequest } from "@/types/index";
import { previewState } from "@/services/overlay/changeRequestPreviewState";

// Composable to handle change request position preview
// Combines state management + navigation logic for previewing change request positions

interface PreviewGeometryOptions {
  change: PendingChangeRequest;
  overlayForModeration: OverlayForModeration;
  geometryValue: unknown;
  type: "old" | "new";
}

// Type guard for coordinate object
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

  // Type guard for coordinate array
  function isCoordinateArray(value: unknown): value is { lat: number; lng: number }[] {
    return Array.isArray(value) && value.length > 0 && value.every(isCoordinate);
  }

  // Parse geometry value into corner coordinates
  // Handles both single coordinate and coordinate arrays from JSONB fields
  function parseGeometry(geometryValue: unknown): { lat: number; lng: number }[] {
    if (!geometryValue || typeof geometryValue !== "object") {
      return [];
    }

    // Single coordinate (centerCoordinate, centroid)
    if (isCoordinate(geometryValue)) {
      return [geometryValue];
    }

    // Array of coordinates (corners)
    if (isCoordinateArray(geometryValue)) {
      return geometryValue;
    }

    return [];
  }

  // Ensure overlay is loaded into the map (handles navigation if needed)
  async function ensureOverlayLoaded(
    overlayForModeration: OverlayForModeration,
    targetCorners: LatLng[],
  ): Promise<boolean> {
    let overlayObject = overlayStore.overlays[overlayForModeration.id];

    // Already loaded, nothing to do
    if (overlayObject && registry.getLayer(overlayObject.id) !== null) {
      return true;
    }

    // Need to load - validate we have required data
    if (!overlayForModeration.cityId || !overlayForModeration.countryCode) {
      toast.add({
        severity: "error",
        summary: t("overlay.missingData"),
        detail: t("overlay.missingCityOrCountry"),
        life: 3000,
      });
      return false;
    }

    // Step 1: Switch to edit mode if needed (pending overlays only visible in edit mode)
    const needsEditMode = overlayStore.mode === "view" && overlayForModeration.status === "pending";
    if (needsEditMode) {
      switchMode("edit");
      await new Promise<void>((resolve) => void setTimeout(() => resolve(), 100));
    }

    // Step 3: Clear map and load cities for the country
    clearAllMapContent();
    const mapStore = useMapStore();
    mapStore.selectedCountryCode = overlayForModeration.countryCode;
    await loadCitiesForCountry(overlayForModeration.countryCode);

    // Step 4: Navigate to overlay position
    const targetBounds = L.latLngBounds(targetCorners);
    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // Step 5: Set selected city state
    selectCity(
      overlayForModeration.cityId,
      overlayForModeration.cityName ?? "City",
      null,
      overlayForModeration.countryCode,
    );

    // Wait for overlays to render
    await new Promise<void>((resolve) => void setTimeout(() => resolve(), 400));

    // Check if overlay loaded successfully
    overlayObject = overlayStore.overlays[overlayForModeration.id];

    if (!overlayObject) {
      // Debug logging for troubleshooting
      console.error("[useChangeRequestPreview] Overlay not loaded after city projects loaded", {
        overlayId: overlayForModeration.id,
        availableOverlays: Object.keys(overlayStore.overlays),
        cityOverlays: mapStore.currentCityOverlays.map((o) => ({ id: o.id, status: o.status })),
        mode: overlayStore.mode,
        status: overlayForModeration.status,
      });

      // One more attempt with longer wait
      const overlayInMapStore = mapStore.currentCityOverlays.find(
        (o) => o.id === overlayForModeration.id,
      );
      if (overlayInMapStore) {
        await new Promise<void>((resolve) => void setTimeout(() => resolve(), 500));
        overlayObject = overlayStore.overlays[overlayForModeration.id];
      }
    }

    if (!overlayObject || registry.getLayer(overlayObject.id) === null) {
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

  // Navigate to position with smooth bounds transition
  function navigateToPosition(
    targetLatLngs: L.LatLng[],
    previousBounds: L.LatLngBounds | null,
    overlayId: string,
  ): void {
    const newBounds = L.latLngBounds(targetLatLngs);

    // If we have previous bounds, create combined bounds to show both positions
    // This creates a smooth unzoom effect instead of jarring camera jump
    const targetBounds = previousBounds ? newBounds.extend(previousBounds) : newBounds;

    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // Select overlay after flyTo completes
    map.value.once("moveend", () => {
      selectOverlay(overlayId);
    });
  }

  // Get target corners based on preview type
  function getTargetCorners(overlayObject: OverlayObject, type: "old" | "new"): L.LatLng[] | null {
    if (type === "new") {
      // Show suggested position
      if (overlayObject.suggestedCorners?.length !== 4) {
        console.warn("No suggested corners available for overlay", overlayObject.id);
        return null;
      }
      return overlayObject.suggestedCorners.map((c: { lat: number; lng: number }) =>
        L.latLng(c.lat, c.lng),
      );
    } else {
      // Show approved position (always in corners field)
      if (overlayObject.corners.length !== 4) {
        return null;
      }
      return overlayObject.corners.map((c: { lat: number; lng: number }) => L.latLng(c.lat, c.lng));
    }
  }

  // Apply position preview to loaded overlay
  function applyPositionPreview(
    overlayId: string,
    type: "old" | "new",
    wasAlreadyLoaded: boolean,
  ): void {
    const overlayObject = overlayStore.overlays[overlayId];
    const overlayLayer = overlayObject ? registry.getLayer(overlayObject.id) : null;
    if (!overlayObject || !overlayLayer) {
      return;
    }

    // Capture the current bounds BEFORE switching positions
    // This allows us to show both old and new positions after the switch
    let previousBounds: L.LatLngBounds | null = null;
    if (wasAlreadyLoaded) {
      previousBounds = getOverlayBounds(overlayObject);
    }

    // Get target corners based on type
    const targetLatLngs = getTargetCorners(overlayObject, type);
    if (!targetLatLngs) {
      return;
    }

    // Update overlay state based on type
    if (type === "new") {
      overlayObject.hasPendingChanges = true;
      overlayObject.isViewingApprovedPosition = false;
    } else {
      overlayObject.isViewingApprovedPosition = true;
    }

    // Apply the position change
    overlayLayer.setCorners(targetLatLngs);
    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);

    // Always navigate to the final position to ensure camera is centered correctly
    navigateToPosition(targetLatLngs, previousBounds, overlayId);
  }

  // Main function to preview geometry change
  async function previewGeometry(options: PreviewGeometryOptions): Promise<void> {
    const { change, overlayForModeration, geometryValue, type } = options;

    try {
      // Step 1: Parse geometry
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

      // Step 2: Check if overlay is already loaded
      const wasAlreadyLoaded = registry.getLayer(change.entityId) !== null;

      // Step 3: Ensure overlay is loaded (handles navigation if needed)
      const loaded = await ensureOverlayLoaded(overlayForModeration, latLngs);
      if (!loaded) {
        return;
      }

      // Step 4: Apply position preview
      applyPositionPreview(change.entityId, type, wasAlreadyLoaded);

      // Step 5: Update state machine
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
    previewState,
    isPreviewingChange,
    getPreviewType,
    previewGeometry,
  };
}
