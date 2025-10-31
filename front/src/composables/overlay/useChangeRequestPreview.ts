import L from 'leaflet';
import type { LatLng } from 'leaflet';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '@composables/ui/useToast';
import { map } from '@composables/core/useMap';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { updateMarkerPosition, updateMarkerTooltip, clearAllOverlays } from '@composables/overlay/useOverlay';
import { loadCityProjects, removeCityMarkers, addCityMarkersForCountry } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { toggleEditMode } from '@composables/overlay/useOverlayModes';
import { mobileAwareFlyToBounds } from '@composables/map/useMapNavigation';
import type { PendingChangeRequest } from '../../types/api';
import type { OverlayForModeration } from '@types';

// AI : Composable to handle change request position preview
// AI : Combines state management + navigation logic for previewing change request positions

// AI : State machine for position preview
export type PreviewState =
  | { type: 'none' }
  | { type: 'current'; changeId: string; overlayId: string }
  | { type: 'suggested'; changeId: string; overlayId: string; corners: { lat: number; lng: number }[] };

const previewState = ref<PreviewState>({ type: 'none' });

interface PreviewGeometryOptions {
  change: PendingChangeRequest;
  overlayForModeration: OverlayForModeration;
  geometryValue: unknown;
  type: 'old' | 'new';
}

export function useChangeRequestPreview() {
  const { t } = useI18n();
  const toast = useToast();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  // AI : State management (from usePositionPreview)
  const hasActivePreview = computed(() => previewState.value.type !== 'none');

  function isPreviewingChange(changeId: string): boolean {
    const state = previewState.value;
    if (state.type === 'none') return false;
    return state.changeId === changeId;
  }

  function getPreviewType(changeId: string): 'current' | 'suggested' | null {
    const state = previewState.value;
    if (state.type === 'none' || state.changeId !== changeId) return null;
    return state.type === 'current' ? 'current' : 'suggested';
  }

  function clearPreview(): void {
    previewState.value = { type: 'none' };
  }

  // AI : Parse geometry value into corner coordinates
  function parseGeometry(geometryValue: unknown): { lat: number; lng: number }[] {
    if (!geometryValue || typeof geometryValue !== 'object') {
      return [];
    }

    const geo = geometryValue as any;

    if ('lat' in geo && 'lng' in geo) {
      return [{ lat: geo.lat, lng: geo.lng }];
    }

    if (Array.isArray(geo) && geo.length > 0 && 'lat' in geo[0] && 'lng' in geo[0]) {
      return geo;
    }

    return [];
  }

  // AI : Ensure overlay is loaded into the map (handles navigation if needed)
  async function ensureOverlayLoaded(
    overlayForModeration: OverlayForModeration,
    targetCorners: LatLng[]
  ): Promise<boolean> {
    let overlayObject = overlayStore.overlays[overlayForModeration.id];

    // AI : Already loaded, nothing to do
    if (overlayObject?.overlay != null) {
      return true;
    }

    // AI : Need to load - validate we have required data
    if (!overlayForModeration.cityId || !overlayForModeration.countryCode || !map.value) {
      toast.add({
        severity: 'error',
        summary: t('overlay.missingData'),
        detail: t('overlay.missingCityOrCountry'),
        life: 3000
      });
      return false;
    }

    // AI : Step 1: Switch to edit mode if needed (pending overlays only visible in edit mode)
    const needsEditMode = overlayStore.mode === 'view' && overlayForModeration.status === 'pending';
    if (needsEditMode) {
      await toggleEditMode();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // AI : Step 2: Prepare map context (tile layer, clear old state)
    switchTileLayer(
      isTileLayerType(overlayForModeration.countryCode)
        ? overlayForModeration.countryCode
        : 'esri'
    );

    removeCityMarkers();
    removeOverlayMarkers();
    clearAllOverlays();
    mapStore.currentCityOverlays = [];
    mapStore.clearSelectedCity();
    mapStore.selectedCountryCode = overlayForModeration.countryCode;

    // AI : Step 3: Load country/city data
    await loadCitiesForCountry(overlayForModeration.countryCode);

    const country = projectStore.countries.find((c: any) => c.code === overlayForModeration.countryCode);
    if (country) {
      addCityMarkersForCountry(country.cities.map((city: any) => ({ ...city, projectCount: 0 })));
    }

    // AI : Step 4: Navigate to overlay position
    const targetBounds = L.latLngBounds(targetCorners);
    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25
    });

    // AI : Wait for navigation to complete
    await new Promise<void>(resolve => {
      if (map.value != null) {
        map.value.once('moveend', () => {
          setTimeout(resolve, 100);
        });
      } else {
        resolve();
      }
    });

    // AI : Step 5: Load city projects (this renders overlays)
    await loadCityProjects(
      overlayForModeration.cityId,
      overlayForModeration.cityName ?? 'City',
      true, // AI : Force full load regardless of zoom
      overlayForModeration.countryCode
    );

    // AI : Wait for overlays to render
    await new Promise(resolve => setTimeout(resolve, 400));

    // AI : Check if overlay loaded successfully
    overlayObject = overlayStore.overlays[overlayForModeration.id];

    if (!overlayObject) {
      // AI : Debug logging for troubleshooting
      console.error('[useChangeRequestPreview] Overlay not loaded after city projects loaded', {
        overlayId: overlayForModeration.id,
        availableOverlays: Object.keys(overlayStore.overlays),
        cityOverlays: mapStore.currentCityOverlays.map(o => ({ id: o.id, status: o.status })),
        mode: overlayStore.mode,
        status: overlayForModeration.status
      });

      // AI : One more attempt with longer wait
      const overlayInMapStore = mapStore.currentCityOverlays.find(o => o.id === overlayForModeration.id);
      if (overlayInMapStore) {
        await new Promise(resolve => setTimeout(resolve, 500));
        overlayObject = overlayStore.overlays[overlayForModeration.id];
      }
    }

    if (overlayObject?.overlay == null) {
      toast.add({
        severity: 'error',
        summary: t('overlay.loadFailed'),
        detail: t('overlay.couldNotLoadOverlay'),
        life: 3000
      });
      return false;
    }

    return true;
  }

  // AI : Apply position preview to loaded overlay
  function applyPositionPreview(
    overlayId: string,
    corners: LatLng[],
    type: 'old' | 'new',
    wasAlreadyLoaded: boolean
  ): void {
    const overlayObject = overlayStore.overlays[overlayId];
    if (!overlayObject?.overlay || corners.length !== 4) {
      return;
    }

    if (type === 'new') {
      // AI : Show suggested position
      overlayObject.overlay.setCorners(corners);
      overlayObject.hasPendingChanges = true;
      updateMarkerPosition(overlayObject);
      updateMarkerTooltip(overlayObject);

      // AI : Show current/approved position
    } else {
      // AI : Use approvedCorners if available (for overlays with pending changes)
      // AI : Otherwise fall back to corners (for overlays without pending changes)
      const cornersToUse = (overlayObject.approvedCorners && overlayObject.approvedCorners.length === 4)
        ? overlayObject.approvedCorners
        : overlayObject.corners;

      if (cornersToUse && cornersToUse.length === 4) {
        const approvedLatLngs = cornersToUse.map(c => L.latLng(c.lat, c.lng));
        overlayObject.overlay.setCorners(approvedLatLngs);
        overlayObject.hasPendingChanges = false;
        updateMarkerPosition(overlayObject);
        updateMarkerTooltip(overlayObject);
        // AI : Restore hasPendingChanges flag after marker update
        overlayObject.hasPendingChanges = true;
      } else {
        overlayObject.overlay.setCorners(corners);
        updateMarkerPosition(overlayObject);
        updateMarkerTooltip(overlayObject);
      }
    }

    // AI : If overlay was already visible, fly to the new position
    if (wasAlreadyLoaded && map.value) {
      const bounds = L.latLngBounds(overlayObject.overlay.getCorners());
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25
      });
    }
  }

  // AI : Main function to preview geometry change
  async function previewGeometry(options: PreviewGeometryOptions): Promise<void> {
    const { change, overlayForModeration, geometryValue, type } = options;

    try {
      // AI : Step 1: Parse geometry
      const corners = parseGeometry(geometryValue);

      if (corners.length === 0) {
        toast.add({
          severity: 'warn',
          summary: t('overlay.invalidCoordinates'),
          detail: t('overlay.couldNotParseCoordinates'),
          life: 3000
        });
        return;
      }

      const latLngs = corners.map(c => L.latLng(c.lat, c.lng));

      // AI : Step 2: Check if overlay is already loaded
      const wasAlreadyLoaded = !!overlayStore.overlays[change.entityId]?.overlay;

      // AI : Step 3: Ensure overlay is loaded (handles navigation if needed)
      const loaded = await ensureOverlayLoaded(overlayForModeration, latLngs);
      if (!loaded) {
        return;
      }

      // AI : Step 4: Apply position preview
      applyPositionPreview(change.entityId, latLngs, type, wasAlreadyLoaded);

      // AI : Step 5: Update state machine
      if (type === 'new') {
        previewState.value = {
          type: 'suggested',
          changeId: change.id,
          overlayId: change.entityId,
          corners
        };
      } else {
        previewState.value = {
          type: 'current',
          changeId: change.id,
          overlayId: change.entityId
        };
      }
    } catch (error) {
      console.error('[useChangeRequestPreview] Failed to preview geometry:', error);
      toast.add({
        severity: 'error',
        summary: t('overlay.previewFailed'),
        detail: t('overlay.couldNotPreviewCoordinates'),
        life: 3000
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
    parseGeometry
  };
}
