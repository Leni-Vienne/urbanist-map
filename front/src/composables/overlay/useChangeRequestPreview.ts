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
import { setOverlayImageCorners } from "@/services/overlay/overlayImageLayer";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { clearAllMapContent } from "@/services/overlay/overlayLifecycle";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import type { OverlayForModeration, OverlayObject, PendingChangeRequest } from "@/types/index";
import { previewState } from "@/services/overlay/changeRequestPreviewState";

// Composable to handle change request position preview on the map

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

// Type guard for coordinate array
function isCoordinateArray(value: unknown): value is { lat: number; lng: number }[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCoordinate);
}

// Parse geometry value into corner coordinates (single coord or coordinate array from JSONB)
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

function isPreviewingChange(changeId: string): boolean {
  const state = previewState.value;
  if (state.type === "none") return false;
  return state.changeId === changeId;
}

// Navigate to position, combining new and previous bounds for a smooth unzoom effect
function navigateToPosition(
  targetLatLngs: L.LatLng[],
  previousBounds: L.LatLngBounds | null,
  overlayId: string,
): void {
  const newBounds = L.latLngBounds(targetLatLngs);

  // Extend with previous bounds so both positions stay visible during transition
  const targetBounds = previousBounds ? newBounds.extend(previousBounds) : newBounds;

  mobileAwareFlyToBounds(targetBounds);

  // Select overlay after flyTo completes
  map.value.once("moveend", () => {
    selectOverlay(overlayId);
  });
}

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
  }
  // Show approved position (always in corners field)
  if (overlayObject.corners.length !== 4) {
    return null;
  }
  return overlayObject.corners.map((c: { lat: number; lng: number }) => L.latLng(c.lat, c.lng));
}

function getPreviewType(changeId: string): "current" | "suggested" | null {
  const state = previewState.value;
  if (state.type === "none" || state.changeId !== changeId) return null;
  return state.type === "current" || state.type === "project-current" ? "current" : "suggested";
}

export function useChangeRequestPreview() {
  const toast = useToast();
  const overlayStore = useOverlayStore();

  async function ensureOverlayLoaded(
    overlayForModeration: OverlayForModeration,
    targetCorners: LatLng[],
  ): Promise<boolean> {
    const mapStore = useMapStore();

    let overlayObject = overlayStore.overlays[overlayForModeration.id];

    if (overlayObject && registry.getImageHandle(overlayObject.id) !== null) {
      return true;
    }

    if (!overlayForModeration.countryCode) {
      toast.add({
        severity: "error",
        summary: t("overlay.missingData"),
        detail: t("overlay.missingCityOrCountry"),
        life: 3000,
      });
      return false;
    }

    // Pending overlays are only visible in edit mode
    const needsEditMode = mapStore.mode === "view" && overlayForModeration.status === "pending";
    if (needsEditMode) {
      mapStore.setMode("edit");
      await new Promise<void>(
        (resolve) =>
          void setTimeout(() => {
            resolve();
          }, 100),
      );
    }

    // Clear map and navigate to the overlay's country
    clearAllMapContent();
    mapStore.selectedCountryCode = overlayForModeration.countryCode;

    // Step 4: Navigate to overlay position
    const targetBounds = L.latLngBounds(targetCorners);
    mobileAwareFlyToBounds(targetBounds);

    // Poll until the overlay appears in the store and registry (up to 2s)
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i += 1) {
      await new Promise<void>((resolve) => void setTimeout(resolve, 100));
      overlayObject = overlayStore.overlays[overlayForModeration.id];
      if (overlayObject && registry.getImageHandle(overlayObject.id) !== null) {
        break;
      }
    }

    if (!overlayObject || registry.getImageHandle(overlayObject.id) === null) {
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

  function applyPositionPreview(
    overlayId: string,
    type: "old" | "new",
    wasAlreadyLoaded: boolean,
  ): void {
    const overlayObject = overlayStore.overlays[overlayId];
    if (!overlayObject || registry.getImageHandle(overlayObject.id) === null) {
      return;
    }

    // Capture current bounds before switching, so we can show both positions
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
    setOverlayImageCorners(overlayId, targetLatLngs);
    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);

    // Always navigate to the final position to ensure camera is centered correctly
    navigateToPosition(targetLatLngs, previousBounds, overlayId);
  }

  async function previewGeometry(options: PreviewGeometryOptions): Promise<void> {
    const { change, overlayForModeration, geometryValue, type } = options;

    try {
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

      const wasAlreadyLoaded = registry.getImageHandle(change.entityId) !== null;
      const isTogglingActivePreview =
        previewState.value.type !== "none" && previewState.value.changeId === change.id;

      const loaded = await ensureOverlayLoaded(overlayForModeration, latLngs);
      if (!loaded) {
        return;
      }

      // Don't pass previousBounds when toggling, both positions are already visible
      applyPositionPreview(change.entityId, type, wasAlreadyLoaded && !isTogglingActivePreview);

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
