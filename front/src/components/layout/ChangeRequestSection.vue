<template>
  <div :class="['change-requests-container', containerClass]">
    <div v-if="showHeader" class="change-requests-header">
      <div v-if="isOverlayChanges" class="change-indicator">
        <i class="pi pi-exclamation-triangle text-orange-500"></i>
        <span class="change-header-text">
          {{ isMyContributions
            ? $t('moderation.yourPendingChanges')
            : $t('moderation.pendingChangesFor', { name: entityName })
          }}
        </span>
      </div>
      <h3 v-else class="change-requests-title">
        {{ isMyContributions ? $t('moderation.yourPendingChanges') : $t('moderation.pendingChanges') }}
      </h3>
      <p v-if="isMyContributions" class="change-requests-subtitle">
        {{ $t('moderation.moderatorReviewRequired') }}
      </p>
    </div>

    <div class="change-requests-list">
      <div
        v-for="change in changes"
        :key="change.id"
        :class="['change-item', { 'conflicted': change.status === 'conflicted' }]"
      >
        <div v-if="change.status === 'conflicted'" class="conflict-banner">
          <i class="pi pi-exclamation-triangle"></i>
          <span>{{ $t('moderation.conflictDetected') }}</span>
          <span class="conflict-help">{{ $t('moderation.approveOneToRejectOthers') }}</span>
        </div>
        <div class="change-content">
          <div class="change-field">
            <div class="field-header">
              <strong>{{ change.fieldName }}:</strong>
              <span v-if="change.requestedBy" class="requested-by">
                {{ $t('moderation.by') }} {{ getUserId(change.requestedBy) }}
              </span>
            </div>
            <div v-if="isGeometryField(change.fieldName)" class="geometry-change-controls">
              <div class="geometry-buttons">
                <Button
                  icon="pi pi-map-marker"
                  :label="$t('overlay.viewCurrentPosition')"
                  @click.stop="previewGeometry(change.oldValue, 'old', change.id)"
                  severity="success"
                  :outlined="!(activeGeometryPreview?.changeId === change.id && activeGeometryPreview?.type === 'old')"
                  size="small"
                />
                <Button
                  icon="pi pi-map-marker"
                  :label="$t('overlay.viewSuggestedPosition')"
                  @click.stop="previewGeometry(change.newValue, 'new', change.id)"
                  severity="warn"
                  :outlined="!(activeGeometryPreview?.changeId === change.id && activeGeometryPreview?.type === 'new')"
                  size="small"
                />
              </div>
            </div>
            <div v-else class="change-values">
              <span class="old-value">{{ formatValue(change.oldValue, change.fieldName) }}</span>
              <i class="pi pi-arrow-right"></i>
              <span class="new-value">{{ formatValue(change.newValue, change.fieldName) }}</span>
            </div>
            <div v-if="change.changeReason" class="change-reason">
              <em>{{ $t('moderation.reason') }}: {{ change.changeReason }}</em>
            </div>
            <div class="change-date">
              <em>{{ $t('moderation.requested') }}: {{ new Date(change.createdAt).toLocaleString() }}</em>
            </div>
          </div>
          <div v-if="$slots['change-actions']" class="change-actions">
            <slot name="change-actions" :change="change"></slot>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import L from 'leaflet';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { updateMarkerPosition, updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { map } from '@composables/core/useMap';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useToast } from '@composables/ui/useToast';
import { loadCityProjects } from '@composables/map/useCityMarkers';
import type { PendingChangeRequest } from '../../types/api';
import type { ProjectForModeration, OverlayForModeration } from '@types';

interface Props {
  changes: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  projects: ProjectForModeration[];
  isMyContributions?: boolean;
  isOverlayChanges?: boolean;
  entityName?: string;
  showHeader?: boolean;
  containerClass?: string;
  onNavigateToOverlay?: (overlayId: string) => Promise<void>;
}

const props = withDefaults(defineProps<Props>(), {
  isMyContributions: false,
  isOverlayChanges: false,
  entityName: '',
  showHeader: true,
  containerClass: ''
});

const { t } = useI18n();
const toast = useToast();
const activeGeometryPreview = ref<{ changeId: string; type: 'old' | 'new' } | null>(null);

function isGeometryField(fieldName: string): boolean {
  return fieldName === 'corners' || fieldName === 'centroid';
}

function getUserId(userId: string | null): string {
  if (!userId) return t('common.unknown');
  return userId.slice(0, 8) + '...';
}

function formatValue(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === '') {
    return t('overlay.notSet');
  }

  if (fieldName === 'projectId' && typeof value === 'string') {
    const project = props.projects.find(p => p.id === value);
    return project?.name ?? `Unknown Project (${value.slice(0, 8)}...)`;
  }

  if (fieldName === 'corners' || fieldName === 'centroid') {
    return t('overlay.coordinatesViewOnMap');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

async function previewGeometry(geometryValue: unknown, type: 'old' | 'new', changeId: string) {
  try {
    let corners: { lat: number; lng: number }[] = [];

    if (geometryValue && typeof geometryValue === 'object') {
      const geo = geometryValue as any;

      if ('lat' in geo && 'lng' in geo) {
        corners = [{ lat: geo.lat, lng: geo.lng }];
      } else if (Array.isArray(geo) && geo.length > 0 && 'lat' in geo[0] && 'lng' in geo[0]) {
        corners = geo;
      }
    }

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
    const change = props.allChangeRequests.find(c => c.id === changeId);

    if (change && change.entityType === 'overlay') {
      let overlayForModeration: OverlayForModeration | null = null;
      for (const project of props.projects) {
        if (project.overlays) {
          overlayForModeration = project.overlays.find((o: OverlayForModeration) => o.id === change.entityId) ?? null;
          if (overlayForModeration) break;
        }
      }

      if (!overlayForModeration) {
        toast.add({
          severity: 'error',
          summary: 'Could not find overlay',
          detail: 'Failed to find the overlay data. Please try again.',
          life: 3000
        });
        return;
      }

      const overlayStore = useOverlayStore();
      const { mobileAwareFlyToBounds } = await import('@composables/map/useMobileAwareFly');
      let overlayObject = overlayStore.overlays[change.entityId];
      let wasAlreadyLoaded = !!overlayObject;

      // AI : Check if we need to switch to edit mode to see pending overlays
      const needsEditMode = overlayStore.mode === 'view' && overlayForModeration.status === 'pending';
      if (needsEditMode) {
        const { toggleEditMode } = await import('@composables/overlay/useOverlayModes');
        await toggleEditMode();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // AI : If overlay not loaded, load the complete city context (EXACTLY like clicking overlay card)
      // AI : This replicates navigateToOverlayWithCity() but without camera navigation
      if (!overlayObject) {
        if (!overlayForModeration.cityId || !overlayForModeration.countryCode || !map.value) {
          toast.add({
            severity: 'error',
            summary: 'Missing data',
            detail: 'Overlay is missing city or country information.',
            life: 3000
          });
          return;
        }

        // AI : Step 1: Load country context (replicate prepareNavigationToCity from useOverlayNavigation.ts)
        const { switchTileLayer, isTileLayerType } = await import('@composables/map/useTileLayers');
        const { loadCitiesForCountry } = await import('@composables/map/useCountryMarkers');
        const { removeCityMarkers, addCityMarkersForCountry } = await import('@composables/map/useCityMarkers');
        const { removeOverlayMarkers } = await import('@composables/map/useCityOverlays');
        const { clearAllOverlays } = await import('@composables/overlay/useOverlay');
        const { useMapStore } = await import('@stores/pinia/mapStore');
        const { useProjectStore } = await import('@stores/pinia/projectStore');
        const mapStore = useMapStore();
        const projectStore = useProjectStore();

        // AI : Switch to appropriate tile layer
        switchTileLayer(isTileLayerType(overlayForModeration.countryCode) ? overlayForModeration.countryCode : 'esri');

        // AI : Clear previous state (exactly as country marker click does)
        removeCityMarkers();
        removeOverlayMarkers();
        clearAllOverlays();
        mapStore.currentCityOverlays = [];
        mapStore.clearSelectedCity();

        // AI : Set selected country code so edit mode can reload cities properly
        mapStore.selectedCountryCode = overlayForModeration.countryCode;

        // AI : Load cities for the country (this loads all city data)
        await loadCitiesForCountry(overlayForModeration.countryCode);

        // AI : Add city markers to map (the circular markers users click)
        const country = projectStore.countries.find((c: any) => c.code === overlayForModeration.countryCode);
        if (country) {
          addCityMarkersForCountry(country.cities.map((city: any) => ({ ...city, projectCount: 0 })));
        }

        // AI : Calculate target bounds for smooth navigation (using the requested type's corners)
        const targetBounds = L.latLngBounds(latLngs);

        // AI : Start flying to the overlay position (this ensures zoom >= 12 for overlay loading)
        mobileAwareFlyToBounds(targetBounds, {
          padding: [50, 50] as [number, number],
          duration: 1.5,
          easeLinearity: 0.25
        });

        // AI : Wait for fly animation to complete using moveend event
        await new Promise<void>(resolve => {
          if (map.value) {
            map.value.once('moveend', () => {
              // AI : Add small buffer after moveend for zoom to fully settle
              setTimeout(resolve, 100);
            });
          } else {
            resolve();
          }
        });

        // AI : Step 2: Load city projects (this loads all overlays and development projects)
        // AI : Use forceFullLoad=true to ensure overlays are loaded regardless of zoom
        await loadCityProjects(
          overlayForModeration.cityId,
          overlayForModeration.cityName ?? 'City',
          true, // AI : Force full load to ensure overlays render
          overlayForModeration.countryCode
        );

        // AI : Wait for overlays to render
        await new Promise(resolve => setTimeout(resolve, 400));

        overlayObject = overlayStore.overlays[change.entityId];

        // AI : Debug: Check if overlay was loaded
        if (!overlayObject) {
          console.error('[ChangeRequestSection] Overlay not found in store after loading. Available overlays:', Object.keys(overlayStore.overlays));
          console.error('[ChangeRequestSection] Looking for overlay ID:', change.entityId);
          console.error('[ChangeRequestSection] City overlays in mapStore:', mapStore.currentCityOverlays.map(o => ({ id: o.id, status: o.status })));
          console.error('[ChangeRequestSection] Current mode:', overlayStore.mode);
          console.error('[ChangeRequestSection] Overlay status:', overlayForModeration.status);

          // AI : Check if overlay is in mapStore but not yet rendered
          const overlayInMapStore = mapStore.currentCityOverlays.find(o => o.id === change.entityId);
          if (overlayInMapStore) {
            console.warn('[ChangeRequestSection] Overlay found in mapStore but not in overlayStore. Waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 500));
            overlayObject = overlayStore.overlays[change.entityId];
          }
        }
      }

      // AI : Verify overlay loaded successfully
      if (!overlayObject?.overlay) {
        console.error('[ChangeRequestSection] Overlay object or overlay.overlay is null', {
          hasOverlayObject: !!overlayObject,
          hasOverlay: !!overlayObject?.overlay,
          overlayId: change.entityId
        });

        toast.add({
          severity: 'error',
          summary: 'Could not load overlay',
          detail: 'The overlay could not be loaded. Please try again.',
          life: 3000
        });
        return;
      }

      // AI : Manipulate corners based on type
      if (corners.length === 4) {
        if (type === 'new') {
          // AI : Show suggested position
          overlayObject.overlay.setCorners(latLngs);
          overlayObject.hasPendingChanges = true;
          updateMarkerPosition(overlayObject);
          updateMarkerTooltip(overlayObject);
        } else if (type === 'old') {
          // AI : Show current/approved position
          if (overlayObject.corners && overlayObject.corners.length === 4) {
            const approvedCorners = overlayObject.corners.map(c => L.latLng(c.lat, c.lng));
            overlayObject.overlay.setCorners(approvedCorners);
            overlayObject.hasPendingChanges = false;
            updateMarkerPosition(overlayObject);
            updateMarkerTooltip(overlayObject);
            // AI : Restore hasPendingChanges flag after marker update
            overlayObject.hasPendingChanges = true;
          } else {
            overlayObject.overlay.setCorners(latLngs);
            updateMarkerPosition(overlayObject);
            updateMarkerTooltip(overlayObject);
          }
        }

        // AI : If overlay was already loaded (toggling between positions), fly to the new position
        if (wasAlreadyLoaded && map.value) {
          const bounds = L.latLngBounds(overlayObject.overlay.getCorners());
          mobileAwareFlyToBounds(bounds, {
            padding: [50, 50] as [number, number],
            duration: 1.5,
            easeLinearity: 0.25
          });
        }
      }
    }

    activeGeometryPreview.value = { changeId, type };
  } catch (error) {
    console.error('Failed to preview geometry:', error);
    toast.add({
      severity: 'error',
      summary: t('overlay.previewFailed'),
      detail: t('overlay.couldNotPreviewCoordinates'),
      life: 3000
    });
  }
}
</script>

<style scoped>
.change-requests-container {
  margin-top: 1rem;
}

.project-change-requests {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.overlay-change-requests {
  padding: 0.75rem 1rem;
  background: var(--p-orange-25);
  border-top: 1px solid var(--p-orange-200);
}

.change-requests-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.change-requests-subtitle {
  margin: 0.5rem 0 0 0;
  font-size: 0.75rem;
  color: var(--p-surface-500);
  font-style: italic;
}

.change-requests-header {
  margin-bottom: 0.75rem;
}

.change-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.change-header-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-orange-700);
}

.change-requests-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-item {
  background: white;
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  padding: 0.5rem;
}

.change-item.conflicted {
  border-color: var(--p-orange-400);
  border-width: 2px;
  background: var(--p-orange-25);
}

.conflict-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem 0.5rem -0.5rem;
  background: var(--p-orange-100);
  border-bottom: 1px solid var(--p-orange-200);
  border-radius: 4px 4px 0 0;
  color: var(--p-orange-700);
  font-weight: 600;
  font-size: 0.8125rem;
}

.conflict-banner i {
  color: var(--p-orange-600);
}

.conflict-help {
  margin-left: auto;
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--p-orange-600);
}

.field-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.requested-by {
  font-size: 0.75rem;
  color: var(--p-surface-500);
  font-weight: 400;
}

.change-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-field {
  flex: 1;
  min-width: 0;
}

.change-field strong {
  color: var(--p-surface-700);
  font-size: 0.8125rem;
}

.change-values {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.old-value {
  color: #059669;
  background: #ecfdf5;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 150px;
}

.new-value {
  color: var(--p-tag-warn-color);
  background: var(--p-tag-warn-background);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 150px;
}

.change-reason {
  font-size: 0.75rem;
  color: var(--p-surface-600);
  margin-top: 0.25rem;
}

.change-date {
  font-size: 0.75rem;
  color: var(--p-surface-400);
  margin-top: 0.25rem;
}

.change-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-shrink: 0;
}

.geometry-change-controls {
  margin: 0.5rem 0;
}

.geometry-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
