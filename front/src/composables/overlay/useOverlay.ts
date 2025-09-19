import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { updateOverlayMarkersColors } from '@composables/map/useOverlayMarkerUpdates';
import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage';
import { shallowRef, type Ref } from 'vue';
import { map } from '@composables/core/useMap';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { storeToRefs } from 'pinia';
import type { OverlayObject, CDNOverlayData, Project } from '@types';
import { createOverlay as createOverlayInstance, createOverlayFromCDN, transformBackendOverlayToCDN } from '../../utils/typeFactories';

import { createColorIcon } from '@composables/ui/markerIcons';
import { useProjects, addOverlayToProjectWithId } from '@composables/project/useProjects';
import { trpc } from '@client';

// AI : Export reactive refs from stores
export let overlays: Ref<Record<string, OverlayObject>>;
export let idSelectedOverlay: Ref<string | null>;
export let isEditMode: Ref<boolean>;
export let projects: Ref<Record<string, Project>>;

// AI : Initialize stores - will be called during app initialization
export function initializeStores() {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const overlayStoreRefs = storeToRefs(overlayStore);
  const projectStoreRefs = storeToRefs(projectStore);

  // AI : Connect the exported refs to the store refs
  overlays = overlayStoreRefs.overlays;
  idSelectedOverlay = overlayStoreRefs.idSelectedOverlay;
  isEditMode = overlayStoreRefs.isEditMode;
  projects = projectStoreRefs.projects;

  // AI : Initialize overlay marker updates with store refs
  // We need to get currentCityOverlays from useCityMarkers, but we can't import it due to circular dep
  // So we'll initialize it when currentCityOverlays is set elsewhere

  return { ...overlayStoreRefs, ...projectStoreRefs };
}

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

/**
 * AI : Update overlay editing state based on current mode
 * AI : This function recreates overlays to update toolbar actions properly
 */
export function updateOverlayEditingState(): void {
  // AI : Update existing overlays in-place instead of recreating them
  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (!overlayObject.overlay) return;

    // AI : Update overlay options using the new setOptions method
    overlayObject.overlay.setOptions({
      actions: [...(isEditMode.value ? editTools : viewTools)],
      draggable: isEditMode.value,
    });

    // AI : When entering edit mode, restore cached corner positions if they exist
    if (isEditMode.value) {
      const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
      if (cachedModifications?.corners?.length === 4) {
        // AI : Restore cached corners to overlay
        const leafletCorners = cachedModifications.corners.map(corner => L.latLng(corner.lat, corner.lng));
        overlayObject.overlay.setCorners(leafletCorners);
        
        // AI : Update overlay object state
        overlayObject.history = [cachedModifications.corners];
        overlayObject.isModified = cachedModifications.isModified;
        
        // AI : Update marker position to match restored corners
        updateMarkerPosition(overlayObject);
      }
    }

    // AI : Update marker color and tooltip
    updateMarkerTooltip(overlayObject);
  });
}

/**
 * AI : Create a new overlay object from saved data
 */
export function createOverlayObject(savedOverlay: OverlayObject): OverlayObject {
  // AI : Prefer the project data already on the overlay object, fallback to projects store
  const project = savedOverlay.project || (savedOverlay.projectId ? projects.value[savedOverlay.projectId] : null);

  // AI : Use factory function but preserve existing data
  return createOverlayInstance({
    ...savedOverlay,
    project: project ? { ...project, city: project.city ?? null } : null,
    overlay: null,
    marker: null,
    isFlipped: false,
    currentResolution: savedOverlay.imageUrl,
    corners: [
      { lat: savedOverlay.topLeftLat, lng: savedOverlay.topLeftLng },
      { lat: savedOverlay.topRightLat, lng: savedOverlay.topRightLng },
      { lat: savedOverlay.bottomRightLat, lng: savedOverlay.bottomRightLng },
      { lat: savedOverlay.bottomLeftLat, lng: savedOverlay.bottomLeftLng },
    ]
  });
}

/**
 * AI : Create a Leaflet overlay on the map
 */
export function createOverlay(imageUrl: string, overlayObject?: OverlayObject) {
  if (!map.value || !overlayObject) return null;

  overlayObject.imageUrl ??= imageUrl;

  try {
    // AI : Get corners with edit mode cache awareness for position persistence
    const corners = getCornersForOverlayWithCache(overlayObject);

    // AI : Convert corners to Leaflet LatLng objects if available
    const leafletCorners = corners && isValidCorners(corners)
      ? corners.map(corner => L.latLng(corner.lat, corner.lng))
      : undefined;

    const newOverlay = L.distortableImageOverlay(imageUrl, {
      editable: true,
      keyboard: false,
      actions: [
        ...(isEditMode.value ? editTools : viewTools)
      ],
      corners: leafletCorners,
      dragBehavior: 'auto',
      selectOnDrag: false,
      draggable: isEditMode.value,
    });

    // IMPORTANT : this waits for any ongoing zoom animation to complete before adding overlay to prevent visual glitch
    // This fixes the bug when zooming multiple levels past the render threshold at once
    const addOverlayWhenReady = () => {
      if (map.value && newOverlay) {
        newOverlay.addTo(map.value);
      }
    };

    // Check if map is currently zooming, _animatingZoom isn't documented for some reason
    if (map.value?._animatingZoom) {
      // AI : Wait for zoom animation to complete
      map.value.once('zoomend', addOverlayWhenReady);
    } else {
      // No zoom animation, add immediately
      addOverlayWhenReady();
    }
    overlayObject.overlay = newOverlay;

    setupOverlayEventHandlers(newOverlay, overlayObject);
    setupOverlayLoadHandler(newOverlay, overlayObject);

    return newOverlay;
  } catch (error) {
    console.error('AI : Error creating overlay:', error);
    return null;
  }
}

/**
 * AI : Handle overlay load event with all initialization logic
 */
function setupOverlayLoadHandler(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  const element = overlay.getElement();
  if (!element) {
    // AI : Element should be available immediately after addTo(), but add minimal fallback
    requestAnimationFrame(() => { setupOverlayLoadHandler(overlay, overlayObject); });
    return;
  }

  L.DomEvent.on(element, 'load', () => {
    if (element.complete && element.naturalWidth > 0) {
      onOverlayLoaded(overlayObject);
    }
  });

  if (element.complete && element.naturalWidth > 0) {
    onOverlayLoaded(overlayObject);
  }
}

/**
 * AI : Handle all logic when overlay finishes loading
 */
function onOverlayLoaded(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  updateMarkerPosition(overlayObject);

  initializeOverlayHistory(overlayObject);

  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Initialize history for overlay if not already set
 */
function initializeOverlayHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  // AI : Only initialize if history is completely empty
  if (overlayObject.history.length > 0) {
    return;
  }

  const initialCorners = overlayObject.overlay.getCorners();
  if (initialCorners?.length === 4) {
    overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))];
    overlayObject.redoStack = [];
  }
}

function setupOverlayEventHandlers(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {

  overlay.on('select', () => {
    // AI : Update the selected overlay ID (this updates the store since we're using store refs)
    idSelectedOverlay.value = overlayObject.id;

    // AI : Apply selection outline
    applySelectionOutline(overlayObject);
  });

  overlay.on('deselect', () => {
    // AI : Only handle deselect for the overlay that was actually selected
    if (idSelectedOverlay.value === overlayObject.id) {
      idSelectedOverlay.value = null;

      // AI : Remove selection outline
      removeSelectionOutline(overlayObject);

      // AI : Hide InfoPopup when overlay is deselected
      const overlayStore = useOverlayStore();
      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }
    }
  });

  // Listens to the map being moved
  overlay.on('dragend', () => {
    saveToHistory(overlayObject);
  })

  // listens to individual corners being moved
  overlay.on('edit', () => {
    // AI : Handle transition from backend to local copy when edited
    updateMarkerPosition(overlayObject);

    saveToHistory(overlayObject);
  });

  // AI : Set up comprehensive event handlers for overlay manipulation
  setupOverlayMovementTracking(overlay, overlayObject);
}


/**
 * AI : Get corners for overlay based on priority: history > coordinates > default
 */
function getCornersForOverlay(overlayObject: OverlayObject) {
  // AI : Priority 1: Use history if available (for undo/redo)
  if (overlayObject.history?.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners?.length === 4) return lastCorners;
  }

  // ugly but since the type expects non null AND DistortableImage needs null corners for the initial state
  // AI : Priority 2: Use individual lat/lng fields (skip if all zeros - indicates new overlay)
  if (overlayObject.topLeftLat != null && overlayObject.topLeftLng != null &&
    !(overlayObject.topLeftLat === 0 && overlayObject.topLeftLng === 0 &&
      overlayObject.topRightLat === 0 && overlayObject.topRightLng === 0 &&
      overlayObject.bottomRightLat === 0 && overlayObject.bottomRightLng === 0 &&
      overlayObject.bottomLeftLat === 0 && overlayObject.bottomLeftLng === 0)) {
    return [
      { lat: overlayObject.topLeftLat, lng: overlayObject.topLeftLng },
      { lat: overlayObject.topRightLat, lng: overlayObject.topRightLng },
      { lat: overlayObject.bottomRightLat, lng: overlayObject.bottomRightLng },
      { lat: overlayObject.bottomLeftLat, lng: overlayObject.bottomLeftLng },
    ];
  }

  // AI : Priority 3: Initialize from current overlay state
  const currentCorners = overlayObject.overlay?.getCorners();
  if (currentCorners?.length === 4) {
    overlayObject.history = [JSON.parse(JSON.stringify(currentCorners))];
    overlayObject.redoStack = [];
    return currentCorners;
  }

  return null;
}

/**
 * AI : Get corners for overlay with edit mode cache fallback
 * This function prioritizes edit mode cached modifications for position persistence
 */
function getCornersForOverlayWithCache(overlayObject: OverlayObject) {
  // AI : Priority 1: Check edit mode cache if in edit mode
  if (isEditMode.value) {
    const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
    if (cachedModifications?.corners?.length === 4) {
      // AI : Update object history with cached modifications
      overlayObject.history = [cachedModifications.corners];
      overlayObject.isModified = cachedModifications.isModified;
      return cachedModifications.corners;
    }
  }

  // AI : Priority 2: Use existing logic
  return getCornersForOverlay(overlayObject);
}

/**
 * AI : Validate corners data
 */
function isValidCorners(corners: { lat: number, lng: number }[]): boolean {
  return corners.every(corner =>
    corner &&
    typeof corner.lat === 'number' &&
    typeof corner.lng === 'number' &&
    !isNaN(corner.lat) &&
    !isNaN(corner.lng)
  );
}

function createMarkerTitle(overlay: OverlayObject, projectId: string | null, markerType?: 'new' | 'replacement'): string {
  let baseTitle = markerType === 'replacement' ? 'Replacement Overlay' :
    markerType === 'new' ? 'New Overlay' : 'Overlay';

  if (projectId && projects.value[projectId]) {
    const project = projects.value[projectId];
    const captionPart = overlay.caption ? ` - ${overlay.caption}` : '';
    return markerType ? `${project.name} - ${baseTitle}${captionPart}` : `${project.name}${captionPart}`;
  }

  return baseTitle;
}

/**
 * AI : Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.marker) {
    return;
  }

  const bounds = overlayObject.overlay.getBounds();
  if (bounds?.isValid()) {
    overlayObject.marker.setLatLng(bounds.getCenter());
  }
}

/**
 * AI : Save the current state of an overlay to history
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const currentState = overlayObject.overlay.getCorners();
  if (!currentState?.length) return;

  // AI : Check if current state is different from last saved state
  if (overlayObject.history.length > 0) {
    const lastState = overlayObject.history[overlayObject.history.length - 1];
    const currentStateStr = JSON.stringify(currentState);
    const lastStateStr = JSON.stringify(lastState);

    if (currentStateStr === lastStateStr) {
      return;
    }
  }

  overlayObject.history.push(JSON.parse(JSON.stringify(currentState)) as { lat: number; lng: number }[]);
  overlayObject.redoStack = [];

  // AI : Mark overlay as modified when it's moved/changed
  overlayObject.isModified = true;

  // AI : Save modifications to edit mode cache if in edit mode for persistence across zoom changes
  saveOverlayModificationsToCache(overlayObject);

  updateMarkerTooltip(overlayObject);

  // AI : Update city overlay markers if they are visible
  updateOverlayMarkersColors(overlays, isEditMode);
}

/**
 * AI : Save overlay modifications to edit mode cache for persistence across zoom changes
 */
/**
 * AI : Save overlay modifications to edit mode cache for persistence across zoom changes
 */
function saveOverlayModificationsToCache(overlayObject: OverlayObject): void {
  if (!isEditMode.value || !overlayObject.overlay) return;
  
  const corners = overlayObject.overlay.getCorners();
  if (!corners?.length) return;

  // AI : Save to persistent cache for zoom persistence
  saveToEditModeOverlayCache(overlayObject.id, {
    corners: corners.map(corner => ({ lat: corner.lat, lng: corner.lng })),
    isModified: overlayObject.isModified
  });
}

/**
 * AI : Edit mode overlay cache - stores overlay modifications for persistence across zoom changes
 */
const editModeOverlayCache = new Map<string, { corners: { lat: number, lng: number }[], isModified: boolean }>();

/**
 * AI : Save overlay modifications to edit mode cache
 */
export function saveToEditModeOverlayCache(overlayId: string, data: { corners: { lat: number, lng: number }[], isModified: boolean }): void {
  editModeOverlayCache.set(overlayId, data);
}

/**
 * AI : Get overlay modifications from edit mode cache
 */
export function getFromEditModeOverlayCache(overlayId: string): { corners: { lat: number, lng: number }[], isModified: boolean } | undefined {
  return editModeOverlayCache.get(overlayId);
}

/**
 * AI : Get overlay data with edit modifications applied (for edit mode)
 * @param overlayData - Original overlay data
 * @returns Overlay data with edit modifications applied if in edit mode
 */
function getOverlayDataWithEditModifications(overlayData: CDNOverlayData): CDNOverlayData {
  if (!isEditMode.value) {
    return overlayData; // AI : Return original data in view mode
  }

  // AI : Get edit modifications from the main overlay cache
  const editModifications = getFromEditModeOverlayCache(overlayData.id);
  if (editModifications) {
    // AI : Apply edit modifications
    return {
      ...overlayData,
      corners: editModifications.corners,
      isModified: editModifications.isModified
    };
  }

  return overlayData; // AI : No modifications found
}

/**
 * AI : Clear all edit mode cache
 */
export function clearEditModeOverlayCache(): void {
  editModeOverlayCache.clear();
}

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  if (!map.value) return;

  // AI : Save edit mode modifications before clearing overlays
  if (isEditMode.value) {
    Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
      if (overlayObject.overlay && overlayObject.isModified) {
        saveOverlayModificationsToCache(overlayObject);
      }
    });
  }

  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.overlay) {
      map.value!.removeLayer(overlayObject.overlay);
    }
  });

  Object.values(allMarkers.value).forEach((marker) => {
    if (marker) {
      map.value!.removeLayer(marker);
    }
  });

  overlays.value = {};
  allMarkers.value = {};
  idSelectedOverlay.value = null;

  // AI : Reset UI states when clearing overlays
  const overlayStore = useOverlayStore();
  overlayStore.resetAllUIStates();
}

/**
 * AI : Apply selection outline to overlay when selected
 */
function applySelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.projectId) return;

  const project = projects.value[overlayObject.projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlays.value).forEach((obj: OverlayObject) => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 20px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove selection outline from overlay when deselected
 */
function removeSelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.projectId) return;

  const project = projects.value[overlayObject.projectId];

  Object.values(overlays.value).forEach((obj: OverlayObject) => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline for consistency
        element.style.boxShadow = project ? `0 0 0 2px ${project.color}` : '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Highlight all overlays from the same project on hover in view mode
 */
function highlightProjectOverlaysOnHover(projectId: string): void {
  if (!projectId) return;

  const project = projects.value[projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 20px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove project highlight on mouse leave in view mode
 */
function removeProjectHighlightOnHover(projectId: string): void {
  if (!projectId) return;

  const selectedOverlay = idSelectedOverlay.value ? overlays.value[idSelectedOverlay.value] : null;
  if (selectedOverlay?.projectId === projectId) return;

  const project = projects.value[projectId];

  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline for consistency
        element.style.boxShadow = project ? `0 0 0 2px ${project.color}` : '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Setup hover event listeners for project highlighting in view mode
 */
function setupProjectHoverEvents(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  if (!overlayObject.projectId) return;

  const element = overlay.getElement();
  if (!element) return;

  element.addEventListener('mouseenter', () => {
    if (overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  element.addEventListener('mouseleave', () => {
    if (overlayObject.projectId) {
      removeProjectHighlightOnHover(overlayObject.projectId);
    }
  });
}

/**
 * AI : Render backend CDN overlays on the map for view mode
 */
export function renderViewModeOverlays(cdnOverlays: CDNOverlayData[], createMarkers = true, forceRerender = false) {
  if (!map.value) return;

  let overlaysToRender: CDNOverlayData[];

  if (forceRerender) {
    // AI : Force re-render all overlays (for city switching)
    overlaysToRender = cdnOverlays;
  } else {
    // AI : Only render overlays that aren't already rendered
    const currentOverlayIds = new Set(Object.keys(overlays.value));
    overlaysToRender = cdnOverlays.filter(cdnOverlay => !currentOverlayIds.has(cdnOverlay.id));
  }

  for (const cdnOverlay of overlaysToRender) {
    renderSingleOverlay(cdnOverlay, createMarkers);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 */
function renderSingleOverlay(cdnOverlay: CDNOverlayData, createMarkers = true) {
  if (!map.value || overlays.value[cdnOverlay.id]) return;

  // AI : Apply edit modifications if in edit mode before creating the overlay object
  const overlayDataToUse = getOverlayDataWithEditModifications(cdnOverlay);

  // AI : Use factory function to create overlay from CDN data (with potential edit modifications)
  const overlayObject = createOverlayFromCDN(overlayDataToUse);

  if (createMarkers) {
    createSingleMarker(overlayObject);
  }

  const overlayObjectWithMethods = createOverlayObject(overlayObject);
  const newOverlay = createOverlay(overlayObjectWithMethods.imageUrl, overlayObjectWithMethods);
  if (!newOverlay) return;

  overlayObjectWithMethods.overlay = newOverlay;
  overlayObjectWithMethods.marker = allMarkers.value[cdnOverlay.id];
  overlays.value[cdnOverlay.id] = overlayObjectWithMethods;

  if (overlayObjectWithMethods.overlay) {
    setupProjectHoverEvents(overlayObjectWithMethods.overlay, overlayObjectWithMethods);
  }

  // AI : Update marker tooltip with correct overlay object information
  if (overlayObjectWithMethods.marker) {
    updateMarkerTooltip(overlayObjectWithMethods);
  }
}

/**
 * AI : Remove a specific overlay from the map and collections
 */
export function removeOverlay(overlayId: string): void {
  if (!map.value) return;

  const overlayObject = overlays.value[overlayId];
  if (!overlayObject) return;

  if (overlayObject.overlay) {
    map.value.removeLayer(overlayObject.overlay);
  }

  if (overlayObject.marker) {
    map.value.removeLayer(overlayObject.marker);
  }

  delete overlays.value[overlayId];
  delete allMarkers.value[overlayId];

  if (idSelectedOverlay.value === overlayId) {
    idSelectedOverlay.value = null;
  }
}

/**
 * AI : Update marker tooltip based on overlay storage status
 */
export function updateMarkerTooltip(overlayObject: OverlayObject): void {
  if (!overlayObject.marker) return;

  overlayObject.marker.unbindTooltip();

  const markerColor = getOverlayMarkerColor(overlayObject, isEditMode.value ? 'edit' : 'view');
  const colorIcon = createColorIcon(markerColor);
  overlayObject.marker.setIcon(colorIcon);

  if (!isEditMode.value) {
    return;
  }
  // AI : Generate tooltip text based on overlay state
  const isRemoteOverlay = overlayObject.project !== undefined;
  const hasBeenModified = overlayObject.isModified;
  const isReplacement = overlayObject.replacesOverlayId !== null;

  let tooltipText = '';
  if (isReplacement) {
    tooltipText = 'Replacement overlay';
  } else if (isRemoteOverlay && !hasBeenModified) {
    tooltipText = 'Saved remotely';
  } else if (isRemoteOverlay && hasBeenModified) {
    tooltipText = 'Remote overlay (modified)';
  } else if (!isRemoteOverlay && hasBeenModified) {
    tooltipText = 'Local overlay';
  } else {
    tooltipText = 'New overlay';
  }

  overlayObject.marker.bindTooltip(tooltipText, {
    permanent: false,
    direction: 'top',
    offset: [0, -10]
  });
}

/**
 * AI : Create a single marker for an overlay
 */
function createSingleMarker(savedOverlay: OverlayObject): void {
  if (!map.value || allMarkers.value[savedOverlay.id]) return;

  const overlayBounds = getOverlayBounds(savedOverlay);
  if (!overlayBounds) return;

  const markerTitle = createMarkerTitle(savedOverlay, savedOverlay.projectId);
  const center = overlayBounds.getCenter();
  const tempOverlayObject = createOverlayObject(savedOverlay);
  const markerColor = getOverlayMarkerColor(tempOverlayObject, isEditMode.value ? 'edit' : 'view');
  const colorIcon = createColorIcon(markerColor);

  const marker = L.marker(center, {
    title: markerTitle,
    icon: colorIcon
  }).addTo(map.value);

  allMarkers.value[savedOverlay.id] = marker;
  tempOverlayObject.marker = marker;
  updateMarkerTooltip(tempOverlayObject);
}

function getOverlayBounds(overlay: OverlayObject): L.LatLngBounds | null {
  // AI : Priority 1: Check edit mode cache if in edit mode for the most current position
  if (isEditMode.value) {
    const cachedModifications = getFromEditModeOverlayCache(overlay.id);
    if (cachedModifications?.corners?.length === 4) {
      const corners = cachedModifications.corners.map(corner => L.latLng(corner.lat, corner.lng));
      return L.latLngBounds(corners);
    }
  }

  // AI : Priority 2: Use overlay corners from history if available
  if (overlay.corners?.length === 4) {
    const corners = overlay.corners.map(corner => L.latLng(corner.lat, corner.lng));
    return L.latLngBounds(corners);
  }

  // AI : Priority 3: Validate all corner coordinates exist and are valid numbers
  if (!overlay.topLeftLat || !overlay.topLeftLng ||
    !overlay.topRightLat || !overlay.topRightLng ||
    !overlay.bottomRightLat || !overlay.bottomRightLng ||
    !overlay.bottomLeftLat || !overlay.bottomLeftLng) {
    console.warn('AI : Invalid overlay coordinates for overlay:', overlay.id);
    return null;
  }

  const corners = [
    L.latLng(overlay.topLeftLat, overlay.topLeftLng),
    L.latLng(overlay.topRightLat, overlay.topRightLng),
    L.latLng(overlay.bottomRightLat, overlay.bottomRightLng),
    L.latLng(overlay.bottomLeftLat, overlay.bottomLeftLng),
  ];

  // AI : Check if all corners are valid
  if (corners.some(c => !c.lat || !c.lng)) {
    return null;
  }

  return L.latLngBounds(corners);
}

/**
 * AI : Set up additional movement tracking for overlays (real-time updates during manipulation)
 */
function setupOverlayMovementTracking(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  // AI : Set up DOM event listeners for continuous marker position updates during manipulation
  const element = overlay.getElement();
  if (element) {
    let isManipulating = false;
    let updateFrame: number | null = null;

    const startTracking = () => {
      if (isManipulating) return;
      isManipulating = true;

      // to make the marker follow the overlay being moved 
      const continuousUpdate = () => {
        if (isManipulating) {
          updateMarkerPosition(overlayObject);
          updateFrame = requestAnimationFrame(continuousUpdate);
        }
      };
      continuousUpdate();
    };

    const stopTracking = () => {
      if (!isManipulating) return;
      isManipulating = false;

      if (updateFrame) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }

      // AI : Final marker position update
      updateMarkerPosition(overlayObject);

      // AI : Update city overlay markers if they are visible
      updateOverlayMarkersColors(overlays, isEditMode);
    };

    // AI : Track mouse and touch events for real-time updates
    element.addEventListener('mousedown', startTracking);
    element.addEventListener('touchstart', startTracking, { passive: true });

    document.addEventListener('mouseup', stopTracking);
    document.addEventListener('touchend', stopTracking);
    document.addEventListener('mousemove', () => {
      if (isManipulating) {
        updateMarkerPosition(overlayObject);
      }
    });
    document.addEventListener('touchmove', () => {
      if (isManipulating) {
        updateMarkerPosition(overlayObject);
      }
    }, { passive: true });
  }
}

// AI : Overlay Action Functions (moved from useOverlayActions.ts to break circular dependency)

// AI : Helper function to transform backend overlay to CDN format
// AI : Use factory function from typeFactories.ts - removed local implementation

// AI : Helper function to create new overlay with proper Drizzle schema structure
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  const filename = imageUrl.split('/').pop() ?? '';

  // AI : Use factory function for consistent object creation
  return createOverlayInstance({
    id,
    filename,
    projectId,
    authorId: null,
    imageUrl,
    currentResolution: imageUrl,
    isModified: true, // AI : New overlays need to be uploaded
    savedRemotely: false
  });
}

// AI : Helper function to zoom to overlay bounds with proper error handling
function zoomToOverlayBounds(overlay: OverlayObject): boolean {
  if (!overlay.overlay || !map.value) return false;

  try {
    const bounds = overlay.overlay.getBounds();
    if (bounds) {
      map.value.fitBounds(bounds, { padding: [50, 50] });
      return true;
    } else {
      // AI : Try to get corners for zoom calculation
      const corners = overlay.overlay.getCorners();
      if (corners && corners.length === 4) {
        const overlayBounds = L.latLngBounds(corners);
        map.value.fitBounds(overlayBounds, { padding: [50, 50] });
        return true;
      } else if (overlay.marker) {
        map.value.setView(overlay.marker.getLatLng(), 18);
        return true;
      }
    }
  } catch (error) {
    console.error('Error zooming to overlay bounds:', error);
    if (overlay.marker) {
      map.value.setView(overlay.marker.getLatLng(), 18);
      return true;
    }
  }
  return false;
}

// AI : Helper function to save overlay with updated corners (no local storage)
function saveOverlayWithCurrentCorners(overlayObject: OverlayObject): void {
  if (overlayObject.overlay) {
    const newCorners = overlayObject.overlay.getCorners();
    overlayObject.corners = newCorners;

    // AI : Update marker tooltip after corners are saved
    updateMarkerTooltip(overlayObject);
  }
}

// AI : Helper function to update marker position and save overlay data
function updateMarkerAndSaveOverlay(overlayObject: OverlayObject): void {
  updateMarkerPosition(overlayObject);
  saveOverlayWithCurrentCorners(overlayObject);
}

// AI : Helper function to center map on overlay with proper error handling
function centerMapOnOverlay(overlay: OverlayObject): boolean {
  if (!overlay.overlay) return false;

  // AI : No need to wait for overlay ready since corners are now provided during initialization
  return zoomToOverlayBounds(overlay);
}

/**
 * AI : Create a marker for overlays with specified type and color
 */
function createMarker(overlayObject: OverlayObject, projectId: string, markerType: 'new' | 'replacement'): void {
  if (!map.value) return;

  // AI : Use current map center as initial marker position
  const center = map.value.getCenter();
  const markerTitle = createMarkerTitle(overlayObject, projectId, markerType);

  // AI : Determine marker color based on type and overlay state
  const markerColor = markerType === 'replacement' ? 'purple' : getOverlayMarkerColor(overlayObject, 'edit');
  const colorIcon = createColorIcon(markerColor);

  const marker = L.marker(center, {
    title: markerTitle,
    icon: colorIcon
  }).addTo(map.value);

  // AI : Add click handler to marker to select the overlay
  marker.on('click', () => {
    if (overlayObject.overlay) {
      // AI : If overlay exists, click it to select
      const element = overlayObject.overlay.getElement();
      if (element) {
        element.click();
      }
    } else {
      // AI : If overlay doesn't exist yet, just select it
      idSelectedOverlay.value = overlayObject.id;
    }
  });

  // AI : Store marker reference
  overlayObject.marker = marker;
  allMarkers.value[overlayObject.id] = marker;

  // AI : Update marker tooltip with proper styling
  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Create a purple marker for replacement overlays
 */
function createReplacementMarker(overlayObject: OverlayObject, projectId: string): void {
  createMarker(overlayObject, projectId, 'replacement');
}

/**
 * 
 * @param imageUrl 
 * @param projectId 
 * @param replacesOverlayId 
 * @returns the ID of the newly created overlay
 */
export function addOverlay(imageUrl: string, projectId: string, replacesOverlayId?: string) {
  // AI : Only allow adding overlays in edit mode
  if (!isEditMode.value) {
    console.warn('Cannot add overlay in view mode');
    return;
  }

  if (!map.value) return;
  if (!projectId) {
    throw new Error('Project Required: A project must be selected to add an overlay');
  }

  const id = crypto.randomUUID();

  // AI : Create overlay object using proper schema structure
  const overlayObject = createNewOverlayObject(id, imageUrl, projectId);

  // AI : If this is a replacement overlay, set the replacement reference
  if (replacesOverlayId) {
    overlayObject.replacesOverlayId = replacesOverlayId;
    const originalOverlay = overlays.value[replacesOverlayId];
    overlayObject.caption = `Replacement for ${originalOverlay?.caption ?? 'overlay'}`;
  }

  // Create the overlay
  const newOverlay = createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  // Store reference and initialize
  overlays.value[id] = overlayObject;

  // AI : Create marker with appropriate color based on replacement status
  if (replacesOverlayId) {
    createReplacementMarker(overlayObject, projectId);
  } else {
    createMarkerForNewOverlay(overlayObject, projectId);
  }

  // AI : Don't set up custom load handler - let the existing setupOverlayLoadHandler handle it
  // The existing system in useOverlay.ts will call onOverlayLoaded which handles all initialization

  addOverlayToProjectWithId(projectId, id);

  // AI : Select the new overlay (important for replacement overlays)
  idSelectedOverlay.value = id;

  return id;
}

// AI : Create marker for new overlay at map center (before image loads)
function createMarkerForNewOverlay(overlayObject: OverlayObject, projectId: string): void {
  createMarker(overlayObject, projectId, 'new');
}

export function undo() {
  applyHistoryAction('undo');
}

export function redo() {
  applyHistoryAction('redo');
}

function applyHistoryAction(action: 'undo' | 'redo') {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  const { history, redoStack, overlay } = overlayObject;
  const isUndo = action === 'undo';

  if ((isUndo && history.length <= 1) || (!isUndo && redoStack.length === 0)) {
    return;
  }

  try {
    if (isUndo) {
      // AI : For undo: move current state to redo stack and apply previous state
      const currentState = history.pop()!;
      redoStack.push(currentState);
      const previousState = history[history.length - 1];
      overlay.setCorners(previousState);
    } else {
      // AI : For redo: move state from redo stack to history and apply it
      const stateToRestore = redoStack.pop()!;
      history.push(stateToRestore);
      overlay.setCorners(stateToRestore);
    }

    updateMarkerAndSaveOverlay(overlayObject);
  } catch (error) {
    console.error(`AI : Error during ${action}:`, error);
    throw error;
  }
}

function resetImageRatio() {
  if (!idSelectedOverlay.value) {
    throw new Error('No image selected: Please select an image first');
  }

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  const img = new Image();
  img.onload = () => {
    if (!overlayObject.overlay || !map.value) return;

    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners?.length || currentCorners.length !== 4) return;

    // AI : Convert corners to Leaflet LatLng objects for type compatibility
    const leafletCorners = currentCorners.map(corner => L.latLng(corner.lat, corner.lng));

    // AI : Save state before applying ratio fix
    saveToHistory(overlayObject);

    const { originalRatio: _originalRatio, newDimensions, cornersInfo } = calculateRatioFixParameters(
      img.naturalWidth / img.naturalHeight,
      leafletCorners
    );

    if (!cornersInfo) return;

    applyImageRatioFix(overlayObject, cornersInfo, newDimensions);
    handleFlipIfNeeded(overlayObject);
    updateMarkerAndSaveOverlay(overlayObject);
  };

  const element = overlayObject.overlay.getElement();
  img.src = overlayObject.imageUrl ?? (element instanceof HTMLImageElement ? element.src : '');
}

interface CornersInfo {
  centerPoint: L.Point;
  angleRad: number;
  isClockwise: boolean;
}

interface Dimensions {
  width: number;
  height: number;
}

function calculateRatioFixParameters(originalRatio: number, currentCorners: L.LatLng[]) {
  if (!map.value) return {
    originalRatio,
    newDimensions: { width: 0, height: 0 },
    cornersInfo: { centerPoint: L.point(0, 0), angleRad: 0, isClockwise: false }
  };

  // Convert corners to screen coordinates
  const nw = map.value.latLngToContainerPoint(currentCorners[0]);
  const ne = map.value.latLngToContainerPoint(currentCorners[1]);
  const sw = map.value.latLngToContainerPoint(currentCorners[2]);
  const se = map.value.latLngToContainerPoint(currentCorners[3]);

  // Calculate current dimensions
  const topEdge = nw.distanceTo(ne);
  const rightEdge = ne.distanceTo(se);
  const bottomEdge = sw.distanceTo(se);
  const leftEdge = nw.distanceTo(sw);

  const currentWidth = (topEdge + bottomEdge) / 2;
  const currentHeight = (leftEdge + rightEdge) / 2;

  // Calculate new dimensions that maintain original ratio
  let newWidth, newHeight;
  if (currentWidth / currentHeight > originalRatio) {
    newHeight = currentHeight;
    newWidth = currentHeight * originalRatio;
  } else {
    newWidth = currentWidth;
    newHeight = currentWidth / originalRatio;
  }

  // Get rotation and center
  const bounds = L.latLngBounds(currentCorners);
  const center = bounds.getCenter();
  const centerPoint = map.value.latLngToContainerPoint(center);

  const topVector = { x: ne.x - nw.x, y: ne.y - nw.y };
  const angleRad = Math.atan2(topVector.y, topVector.x);
  const isClockwise = (ne.x - nw.x) * (se.y - nw.y) - (ne.y - nw.y) * (se.x - nw.x) > 0;

  return {
    originalRatio,
    newDimensions: { width: newWidth, height: newHeight },
    cornersInfo: { centerPoint, angleRad, isClockwise }
  };
}

function applyImageRatioFix(overlayObject: OverlayObject, cornersInfo: CornersInfo, dimensions: Dimensions) {
  if (!map.value || !overlayObject.overlay) return;

  const { centerPoint, angleRad, isClockwise } = cornersInfo;
  const { width, height } = dimensions;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // Calculate corner offsets
  const cornerOffsets = calculateCornerOffsets(angleRad, halfWidth, halfHeight);

  // Create new corner points
  const newCornerPoints = cornerOffsets.map(offset => ({
    x: centerPoint.x + offset.dx,
    y: centerPoint.y + offset.dy
  }));

  // Check if we need to maintain orientation
  const newIsClockwise = (newCornerPoints[1].x - newCornerPoints[0].x) *
    (newCornerPoints[3].y - newCornerPoints[0].y) -
    (newCornerPoints[1].y - newCornerPoints[0].y) *
    (newCornerPoints[3].x - newCornerPoints[0].x) > 0;

  const finalPoints = isClockwise !== newIsClockwise ?
    [...newCornerPoints].reverse() : newCornerPoints;

  // Convert back to geographical coordinates and apply
  const newCorners = finalPoints.map(point =>
    map.value!.containerPointToLatLng([point.x, point.y])
  );

  overlayObject.overlay.setCorners(newCorners);
}

function calculateCornerOffsets(angleRad: number, halfWidth: number, halfHeight: number) {
  return [
    // NW, NE, SW, SE corners
    {
      dx: -halfWidth * Math.cos(angleRad) - halfHeight * Math.sin(angleRad),
      dy: -halfWidth * Math.sin(angleRad) + halfHeight * Math.cos(angleRad)
    },
    {
      dx: halfWidth * Math.cos(angleRad) - halfHeight * Math.sin(angleRad),
      dy: halfWidth * Math.sin(angleRad) + halfHeight * Math.cos(angleRad)
    },
    {
      dx: -halfWidth * Math.cos(angleRad) + halfHeight * Math.sin(angleRad),
      dy: -halfWidth * Math.sin(angleRad) - halfHeight * Math.cos(angleRad)
    },
    {
      dx: halfWidth * Math.cos(angleRad) + halfHeight * Math.sin(angleRad),
      dy: halfWidth * Math.sin(angleRad) - halfHeight * Math.cos(angleRad)
    }
  ];
}

function handleFlipIfNeeded(overlayObject: OverlayObject) {
  if (!overlayObject.overlay) return;

  if (overlayObject.isFlipped) {
    // This is the second click, apply horizontal mirroring
    overlayObject.isFlipped = false;
    const corners = overlayObject.overlay.getCorners();

    // Swap corners for horizontal mirroring: NW<->NE and SW<->SE
    const mirroredCorners = [corners[1], corners[0], corners[3], corners[2]];
    overlayObject.overlay.setCorners(mirroredCorners);

    // AI : Image ratio reset and mirrored
  } else {
    // First click, just set the flag for potential mirroring on next click
    overlayObject.isFlipped = true;

    // AI : Image ratio reset - click again to mirror horizontally
  }
}

/**
 * AI : Navigates between overlays in the current project based on direction
 * @param direction - Either 'next' or 'previous' to determine navigation direction
 * @returns boolean indicating whether navigation was successful
 */

function focusCameraToOverlay(direction: 'next' | 'previous') {
  if (!map.value) {
    throw new Error('Map not available: Cannot navigate between overlays');
  }

  // Handle case when no overlay is selected
  if (!idSelectedOverlay.value) {
    return selectFirstOrLastOverlayInAnyProject(direction);
  }

  const currentOverlay = overlays.value[idSelectedOverlay.value];

  if (!currentOverlay?.projectId) {
    return false;
  }

  const { projects } = useProjects();
  let project = projects.value[currentOverlay.projectId];
  let projectOverlayIds: string[];

  // AI : If project is not in memory, just find overlays with same projectId
  if (!project) {
    projectOverlayIds = Object.values(overlays.value)
      .filter(overlay => overlay.projectId === currentOverlay.projectId)
      .map(overlay => overlay.id);
  } else {
    projectOverlayIds = project.overlayIds;
  }

  if (projectOverlayIds.length <= 1) {
    return false;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(idSelectedOverlay.value);
  const step = direction === 'next' ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];

  return selectAndCenterOverlay(newOverlayId, newIndex, projectOverlayIds.length);
}

function selectFirstOrLastOverlayInAnyProject(direction: 'next' | 'previous') {
  const { projects } = useProjects();
  const projectIds = Object.keys(projects.value);
  if (!projectIds.length) {
    throw new Error('No projects: Please create a project first');
  }

  for (const projectId of projectIds) {
    const project = projects.value[projectId];
    if (project.overlayIds.length > 0) {
      // Select first overlay for 'next', last overlay for 'previous'
      const index = direction === 'next' ? 0 : project.overlayIds.length - 1;
      const overlayId = project.overlayIds[index];

      if (selectAndCenterOverlay(overlayId)) {
        // AI : Selected first/last overlay in project
        return true;
      }
    }
  }

  return false;
}

/**
 * AI : Navigates directly to a specific overlay by ID
 * @param overlayId - The ID of the overlay to navigate to
 * @param centerMap - Whether to center the map on the overlay (defaults to true)
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlay(overlayId: string, centerMap: boolean = true): Promise<boolean> {

  // AI : Check if overlay is already loaded locally
  const existingOverlay = overlays.value[overlayId];

  if (existingOverlay) {

    return selectAndCenterOverlay(overlayId, undefined, undefined, centerMap);

  } else {
    // AI : Overlay not found locally - fetch from backend
    return loadAndNavigateToOverlay(overlayId, centerMap);
  }
}

async function loadAndNavigateToOverlay(overlayId: string, centerMap: boolean): Promise<boolean> {
  try {

    // AI : Fetch overlay and intersecting overlays from backend
    const result = await trpc.overlay.getOverlay.query({
      id: overlayId,
      includeIntersecting: true,
    });

    if (!result.overlay) {
      throw new Error('Overlay not found: The requested overlay could not be found on the server');
    }

    // AI : Render the main overlay
    const cdnOverlay = transformBackendOverlayToCDN(result.overlay);
    renderViewModeOverlays([cdnOverlay], true, false);

    // AI : Render intersecting overlays if they exist
    if (result.intersectingOverlays.length > 0) {
      const intersectingCdnOverlays = result.intersectingOverlays.map(transformBackendOverlayToCDN);
      renderViewModeOverlays(intersectingCdnOverlays, true, false);
    }

    // AI : Verify overlay was successfully loaded
    const loadedOverlay = overlays.value[overlayId];
    if (!loadedOverlay) {
      throw new Error('Loading failed: Failed to load overlay after fetching from server');
    }

    // AI : Navigate to the successfully loaded overlay
    return selectAndCenterOverlay(overlayId, undefined, undefined, centerMap);

  } catch (error) {
    console.error('Error fetching overlay:', error);
    throw new Error('Loading failed: Failed to fetch overlay from server');
  }
}

function selectAndCenterOverlay(overlayId: string, index?: number, total?: number, centerMap: boolean = true) {
  const overlay = overlays.value[overlayId];

  if (!overlay) {
    return false;
  }

  idSelectedOverlay.value = overlayId;

  if (overlay.overlay) {
    // Click on the overlay to properly select it and open the toolbar
    const element = overlay.overlay.getElement();

    if (element) {
      element.click();
    }

    if (centerMap && map.value) {
      // AI : Wait for overlay to be properly initialized before zooming
      centerMapOnOverlay(overlay);
    }
    return true;
  } else if (overlay.marker && centerMap && map.value) {
    // AI : If overlay is not loaded yet but marker exists
    map.value.setView(overlay.marker.getLatLng(), 18);
    return true;
  }

  console.warn('Navigation issue: The overlay exists but could not be shown on the map');
  return false;
}

/**
 * AI : Centers the map view on the next overlay in the current project.
 * Wrapper for focusCameraToOverlay('next')
 */
function goToNextOverlay() {
  focusCameraToOverlay('next');
}

/**
 * AI : Centers the map view on the previous overlay in the current project.
 * Wrapper for focusCameraToOverlay('previous')
 */
function goToPreviousOverlay() {
  focusCameraToOverlay('previous');
}

export function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  if (overlayObject.projectId) {
    const { projects } = useProjects();
    const project = projects.value[overlayObject.projectId];
    if (project) {
      const captionSuffix = overlayObject.caption ? ` - ${overlayObject.caption}` : '';
      const tooltipText = `${project.name}${captionSuffix}`;
      overlayObject.overlay?.bindTooltip(tooltipText, { permanent: true, direction: 'top' }).openTooltip();
    }
  } else {
    overlayObject.overlay.bindTooltip('Overlay', { permanent: true, direction: 'top' }).openTooltip();
  }
}

export function deleteOverlayButtonPressed(id: string) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  // AI : Update project if overlay belongs to one
  if (overlayObject.projectId) {
    const { projects } = useProjects();
    if (projects.value[overlayObject.projectId]) {
      const project = projects.value[overlayObject.projectId];
      // Update local reference only - no backend calls during editing
      project.overlayIds = project.overlayIds.filter(overlayId => overlayId !== id);
      project.updatedAt = new Date();
    }
  }
  removeOverlay(id);
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  overlayObject.caption = info.caption ?? null;

  updateTooltipText();

  // AI : Save only the specific overlay being updated, not all overlays
  saveOverlayWithCurrentCorners(overlayObject);
}

// AI : Toolbar Actions (moved from useTools.ts to break circular dependency)

// AI : Function to get store refs directly from the store
function getStoreRefsForTools() {
  const overlayStore = useOverlayStore();
  const { overlays, idSelectedOverlay, isEditMode } = storeToRefs(overlayStore);
  return { overlays, idSelectedOverlay, isEditMode };
}

export const infoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: 'pi pi-info-circle',
      tooltip: 'Info'
    },
    // @ts-ignore
    subToolbar: new L.Toolbar2({
      actions: [L.EditAction.extend({
        options: {
          toolbarIcon: {
            tooltip: "Info",
            className: "more-info-popup",
          },
        },
        initialize: function () {
          // @ts-ignore
          L.EditAction.prototype.initialize.apply(this, arguments);
        }
      })],
    })
  },
  // very fragile code but necessary to plug into the leaflet toolbar. If you have a better idea, please contribute!
  addHooks() {
    const link = this._link;
    const overlayStore = useOverlayStore();
    const { idSelectedOverlay } = getStoreRefsForTools();

    if (!idSelectedOverlay.value) {
      return;
    }

    // AI : Check if currently open using store state and DOM state
    const { showInfoPopup } = storeToRefs(overlayStore);
    const teleportTargetExists = !!this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
    const isCurrentlyOpen = showInfoPopup.value && teleportTargetExists;

    // IMPORTANT : This if/else is need to toggle open/close the info popup and be able to open it again
    if (isCurrentlyOpen) {
      // AI : Close
      overlayStore.hideInfoPopup();
      this.options.subToolbar._hide();

      // AI : Remove the teleport target and restore original button
      const teleportTarget = this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
      if (teleportTarget?.parentNode) {
        const originalButton = document.createElement('a');
        originalButton.className = "leaflet-toolbar-icon more-info-popup";
        originalButton.href = "#";
        originalButton.title = "Info";
        originalButton.setAttribute('role', 'button');

        teleportTarget.parentNode.replaceChild(originalButton, teleportTarget);
      }
    } else {
      // AI : Open - but first clean up any stale teleport target
      if (teleportTargetExists && !showInfoPopup.value) {
        // AI : Store thinks popup is closed but DOM has teleport target - clean it up
        const staleTarget = this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
        if (staleTarget?.parentNode) {
          const originalButton = document.createElement('a');
          originalButton.className = "leaflet-toolbar-icon more-info-popup";
          originalButton.href = "#";
          originalButton.title = "Info";
          originalButton.setAttribute('role', 'button');
          staleTarget.parentNode.replaceChild(originalButton, staleTarget);
        }
      }

      this.options.subToolbar._show();

      // AI : Wait for subtoolbar to be shown before manipulating it
      const existingButton = this.options.subToolbar._container?.querySelector('.more-info-popup');

      if (existingButton?.tagName === 'A') {
        const teleportTarget = document.createElement('div');
        teleportTarget.id = "info-popup-teleport-target";
        // AI : Ensure teleport target doesn't interfere with map interactions
        teleportTarget.style.cssText = 'pointer-events: none; position: absolute; width: 0; height: 0; overflow: visible;';

        existingButton.parentNode?.replaceChild(teleportTarget, existingButton);

        // AI : Show the info popup for the selected overlay
        if (idSelectedOverlay.value) {
          overlayStore.showInfoPopupForOverlay(idSelectedOverlay.value);
        }
      }
    }

    L.IconUtil.toggleXlink(link, "information", "close");
    L.IconUtil.toggleTitle(link, "Close", "About");
  }
});

export const previousOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-left",
      tooltip: 'Go to previous overlay',
    },
  },
  addHooks: function () {
    goToPreviousOverlay();
  },
});

export const nextOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-right",
      tooltip: 'Go to next overlay',
    },
  },
  addHooks: function () {
    goToNextOverlay();
  },
});

export const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo",
      tooltip: 'Undo (ctrl + z)',
    },
  },
  addHooks: function () {
    undo();
  },
});

export const redoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-refresh",
      tooltip: 'Redo (ctrl + y)',
    },
  },
  addHooks: function () {
    redo();
  },
});

export const mirrorResetTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0078a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 5 5-5 5V7" /><path d="m21 7-5 5 5 5V7" /><path d="M12 20v2" /><path d="M12 14v2" /><path d="M12 8v2" /><path d="M12 2v2" /></svg>',
      tooltip: 'Mirror and reset Image',
    },
  },
  addHooks: function () {
    resetImageRatio();
  },
});

export const customDeleteTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-trash",
      tooltip: "Delete this overlay from local storage",
    },
  },
  addHooks: function () {
    const { idSelectedOverlay } = getStoreRefsForTools();
    if (!idSelectedOverlay.value) {
      return;
    }
    if (confirm('Are you sure you want to delete this overlay from local storage?')) {
      deleteOverlayButtonPressed(idSelectedOverlay.value);
      idSelectedOverlay.value = null;
    }
  },
});

export const replaceOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-image",
      tooltip: "Replace this overlay image",
    },
  },
  addHooks: function () {
    const { idSelectedOverlay } = getStoreRefsForTools();
    if (!idSelectedOverlay.value) {
      return;
    }

    // AI : Use the overlay store for replacement functionality
    const overlayStore = useOverlayStore();

    // AI : Request overlay replacement using the store
    overlayStore.requestOverlayReplacement(idSelectedOverlay.value);
  },
});

export const editTools = [
  infoTool,
  undoTool,
  redoTool,
  L.DragAction,
  L.ResizeRotateAction,
  L.DistortAction,
  mirrorResetTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction,
  replaceOverlayTool,
  customDeleteTool,
];

export const viewTools = [
  infoTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction
];
