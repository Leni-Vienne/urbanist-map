// AI : ============================================================================
// AI : OVERLAY CORE - Central overlay management and rendering
// AI : ============================================================================
// AI : This file handles overlay lifecycle, rendering, and user interactions.
// AI : It's large because overlays are the core domain object with many concerns:
// AI : - Leaflet map integration (creation, rendering, event handling)
// AI : - History management (undo/redo)
// AI : - Navigation (next/prev overlay)
// AI : - Toolbar actions (Leaflet UI glue code)
// AI : - Marker management and positioning
// AI : - Selection and highlighting
// AI : ============================================================================

import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { updateOverlayMarkersColors } from '@composables/map/useOverlayMarkerUpdates';
import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage';
import { map } from '@composables/core/useMap';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import type { OverlayObject, OverlayData } from '@types';
import { createOverlay as createOverlayInstance, createOverlayFromCDN, convertOverlayToData } from '../../utils/typeFactories';
import { toRef } from 'vue';

import { createColorIcon } from '@composables/ui/markerIcons';
import { useProjects, addOverlayToProjectWithId } from '@composables/project/useProjects';
import { trpc } from '@client';
import { getSelectedCity } from '@composables/map/useCityData';
import {
  getOverlayDataWithEditModifications,
  getFromEditModeOverlayCache,
  saveToEditModeOverlayCache,
} from '@composables/overlay/useOverlayEditCache';
import { withErrorHandling } from '@composables/core/useErrorHandling';

/**
 * AI : Update overlay editing state based on current mode
 * AI : This function recreates overlays to update toolbar actions properly
 */
export function updateOverlayEditingState(): void {
  const overlayStore = useOverlayStore();

  // AI : Update existing overlays in-place instead of recreating them
  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (!overlayObject.overlay) return;

    // AI : Update overlay options using the new setOptions method
    overlayObject.overlay.setOptions({
      actions: [...(overlayStore.isEditMode ? editTools : viewTools)],
      draggable: overlayStore.isEditMode,
    });

    // AI : When entering edit mode, restore cached corner positions if they exist
    if (overlayStore.isEditMode) {
      const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
      if (cachedModifications?.corners?.length === 4) {
        // AI : Restore cached corners to overlay
        const leafletCorners = cachedModifications.corners.map(corner => L.latLng(corner.lat, corner.lng));
        overlayObject.overlay.setCorners(leafletCorners);

        // AI : Only initialize history if it's empty (preserve existing undo/redo history)
        if (overlayObject.history.length === 0) {
          overlayObject.history = [cachedModifications.corners];
        }
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
  const projectStore = useProjectStore();

  // AI : Prefer the project data already on the overlay object, fallback to projects store
  const project = savedOverlay.project ?? (savedOverlay.projectId ? projectStore.projects[savedOverlay.projectId] : null);

  // AI : Use factory function but preserve existing data
  return createOverlayInstance({
    ...savedOverlay,
    project: project ? { ...project, city: project.city ?? null } : null,
    overlay: null,
    marker: null,
    isFlipped: false,
    currentResolution: savedOverlay.imageUrl,
    corners: savedOverlay.corners
  });
}

/**
 * AI : Create a Leaflet overlay on the map
 */
export function createOverlay(imageUrl: string, overlayObject?: OverlayObject) {
  const overlayStore = useOverlayStore();

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
        ...(overlayStore.isEditMode ? editTools : viewTools)
      ],
      corners: leafletCorners,
      dragBehavior: 'auto',
      selectOnDrag: false,
      draggable: overlayStore.isEditMode,
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
    // AI : Use error handling utility with toast notification
    withErrorHandling(
      async () => { throw error; },
      { errorMessage: 'Failed to create overlay', logError: true }
    );
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
  const overlayStore = useOverlayStore();

  if (!overlayObject.overlay) return;

  updateMarkerPosition(overlayObject);

  initializeOverlayHistory(overlayObject);

  updateMarkerTooltip(overlayObject);

  // AI : Ensure new overlays start with no outline unless they're selected
  if (overlayStore.idSelectedOverlay !== overlayObject.id) {
    const element = overlayObject.overlay.getElement();
    if (element) {
      element.style.boxShadow = '';
      element.style.outline = 'none';
    }
  }
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
  const overlayStore = useOverlayStore();

  overlay.on('select', () => {
    // AI : Use centralized selection function for consistent behavior
    selectOverlay(overlayObject.id);
  });

  overlay.on('deselect', () => {
    // AI : Only handle deselect for the overlay that was actually selected
    if (overlayStore.idSelectedOverlay === overlayObject.id) {
      // AI : Use centralized selection function (null = deselect all)
      selectOverlay(null);

      // AI : Hide InfoPopup when overlay is deselected
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

  // AI : Priority 2: Use corners from overlayObject (skip if all zeros - indicates new overlay)
  if (overlayObject.corners && overlayObject.corners.length === 4 &&
    !(overlayObject.corners.every(c => c.lat === 0 && c.lng === 0))) {
    return overlayObject.corners;
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
  const overlayStore = useOverlayStore();

  // AI : Check edit mode cache only if in edit mode
  // AI : This ensures view mode always uses backend positions, not stale cached positions
  if (overlayStore.isEditMode) {
    const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
    if (cachedModifications?.corners?.length === 4) {
      // AI : Update object history with cached modifications
      overlayObject.history = [cachedModifications.corners];
      overlayObject.isModified = cachedModifications.isModified;
      return cachedModifications.corners;
    }
  }

  // AI : Use backend corners (view mode or no cache available)
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
  const projectStore = useProjectStore();

  let baseTitle = markerType === 'replacement' ? 'Replacement Overlay' :
    markerType === 'new' ? 'New Overlay' : 'Overlay';

  if (projectId && projectStore.projects[projectId]) {
    const project = projectStore.projects[projectId];
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
  const overlayStore = useOverlayStore();
  updateOverlayMarkersColors(toRef(overlayStore, 'overlays'), toRef(overlayStore, 'isEditMode'));
}

/**
 * AI : Save overlay modifications to edit mode cache for persistence across zoom changes
 */
function saveOverlayModificationsToCache(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();

  if (!overlayStore.isEditMode || !overlayObject.overlay) return;
  const corners = overlayObject.overlay.getCorners();
  if (!corners?.length) return;

  // AI : Save to persistent cache for zoom persistence
  saveToEditModeOverlayCache(overlayObject.id, {
    corners: corners.map(corner => ({ lat: corner.lat, lng: corner.lng })),
    isModified: overlayObject.isModified ?? false
  });
}

/**
 * AI : Add new overlay to city cache so it persists across zoom changes
 */
export function addNewOverlayToCityCache(overlayObject: OverlayObject, cityId: string): void {
  const mapStore = useMapStore();

  // AI : Convert overlay to data format for caching
  const overlayData = convertOverlayToData(overlayObject);

  // AI : Get current city cache or create empty array
  const currentCache = mapStore.getCityProjectsCache(cityId) ?? [];

  // AI : Add new overlay to cache (avoid duplicates)
  const existingIndex = currentCache.findIndex((item) => item.id === overlayObject.id);
  if (existingIndex >= 0) {
    // AI : Update existing entry
    currentCache[existingIndex] = overlayData;
  } else {
    // AI : Add new entry
    currentCache.push(overlayData);
  }

  mapStore.setCityProjectsCache(cityId, currentCache);
}

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.overlay) {
      map.value?.removeLayer(overlayObject.overlay);
    }
    if (overlayObject.marker) {
      map.value?.removeLayer(overlayObject.marker);
    }
  });

  overlayStore.overlays = {};
  overlayStore.allMarkers = {};

  if (overlayStore.idSelectedOverlay) {
    overlayStore.idSelectedOverlay = null;
  }
}

/**
 * AI : Calculate appropriate outline size based on overlay dimensions and aspect ratio
 * This ensures consistent visual outline regardless of overlay shape
 */
function calculateOutlineSize(overlayElement: HTMLElement, baseSize: number): number {
  if (!overlayElement) return baseSize;

  try {
    // AI : Get the actual image element
    const imgElement = overlayElement instanceof HTMLImageElement
      ? overlayElement
      : overlayElement.querySelector('img');

    if (!imgElement) return baseSize;

    // AI : Get natural image dimensions
    const naturalWidth = imgElement.naturalWidth;
    const naturalHeight = imgElement.naturalHeight;

    if (naturalWidth <= 0 || naturalHeight <= 0) return baseSize;

    // AI : Calculate outline size based on image resolution
    // Use the smaller dimension to get consistent visual thickness
    const naturalSmallerDimension = Math.min(naturalWidth, naturalHeight);

    // AI : Scale the base outline size by the image resolution
    // Larger images need proportionally larger outlines to appear the same thickness
    const scaleFactor = naturalSmallerDimension / 500;
    const scaledOutline = baseSize * scaleFactor;

    // AI : Clamp to reasonable bounds
    return Math.max(1, Math.min(50, Math.round(scaledOutline)));

  } catch {
    // AI : Silently fall back to base size on error
    return baseSize;
  }
}

/**
 * AI : Select an overlay with proper cleanup of previous selection
 * This ensures consistent selection behavior regardless of how selection is triggered
 */
function selectOverlay(overlayId: string | null): void {
  const overlayStore = useOverlayStore();

  // AI : Clean up previous selection if different from new selection
  if (overlayStore.idSelectedOverlay && overlayStore.idSelectedOverlay !== overlayId) {
    removeSelectionOutline(overlayStore.overlays[overlayStore.idSelectedOverlay]);
  }

  // AI : Update selected overlay ID
  overlayStore.idSelectedOverlay = overlayId;
  if (!overlayId) return;

  // AI : Apply selection outline to new selection
  const newlySelected = overlayStore.overlays[overlayId];
  if (!newlySelected) return;

  // AI : Wait for image to load before applying outline to avoid massive border
  const imgElement = newlySelected.overlay?.getElement();
  if (!(imgElement instanceof HTMLImageElement)) {
    // AI : Fallback for non-image elements
    applySelectionOutline(newlySelected);
    return;
  }

  if (imgElement.complete && imgElement.naturalWidth > 0) {
    // AI : Image is already loaded, apply outline immediately
    applySelectionOutline(newlySelected);
  } else {
    // AI : Image not loaded yet, wait for load event
    imgElement.addEventListener("load", () => applySelectionOutline(newlySelected), { once: true });
  }
}

function applySelectionOutline(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  if (!overlayObject.overlay || !overlayObject.projectId) return;

  const project = projectStore.projects[overlayObject.projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlayStore.overlays).forEach((obj: OverlayObject) => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Calculate appropriate outline size based on overlay dimensions
        const outlineSize = calculateOutlineSize(element, 20);

        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 ${outlineSize}px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove selection outline from overlay when deselected
 */
function removeSelectionOutline(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();

  if (!overlayObject.overlay || !overlayObject.projectId) return;
  Object.values(overlayStore.overlays).forEach((obj: OverlayObject) => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        element.style.boxShadow = '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Highlight all overlays from the same project on hover in view mode
 */
function highlightProjectOverlaysOnHover(projectId: string): void {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  if (!projectId) return;

  const project = projectStore.projects[projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Calculate appropriate outline size based on overlay dimensions
        const outlineSize = calculateOutlineSize(element, 20);

        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 ${outlineSize}px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove project highlight on mouse leave in view mode
 */
function removeProjectHighlightOnHover(projectId: string): void {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  if (!projectId) return;

  const selectedOverlay = overlayStore.idSelectedOverlay ? overlayStore.overlays[overlayStore.idSelectedOverlay] : null;
  if (selectedOverlay?.projectId === projectId) return;

  const project = projectStore.projects[projectId];

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Calculate appropriate outline size for the default state
        const outlineSize = calculateOutlineSize(element, 2);

        // AI : Use box-shadow instead of outline for consistency
        element.style.boxShadow = project ? `0 0 0 ${outlineSize}px ${project.color}` : '';
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
export function renderViewModeOverlays(viewModeOverlays: OverlayData[], createMarkers = true, forceRerender = false) {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  let overlaysToRender: OverlayData[];

  if (forceRerender) {
    // AI : Force re-render all overlays (for city switching)
    overlaysToRender = viewModeOverlays;
  } else {
    // AI : Only render overlays that aren't already rendered
    const currentOverlayIds = new Set(Object.keys(overlayStore.overlays));
    overlaysToRender = viewModeOverlays.filter(cdnOverlay => !currentOverlayIds.has(cdnOverlay.id));
  }

  for (const cdnOverlay of overlaysToRender) {
    renderSingleOverlay(cdnOverlay, createMarkers);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 */
function renderSingleOverlay(cdnOverlay: OverlayData, createMarkers = true) {
  const overlayStore = useOverlayStore();

  if (!map.value || overlayStore.overlays[cdnOverlay.id]) return;

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
  overlayObjectWithMethods.marker = overlayStore.allMarkers[cdnOverlay.id];
  overlayStore.overlays[cdnOverlay.id] = overlayObjectWithMethods;

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
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  if (overlayObject.overlay) {
    map.value.removeLayer(overlayObject.overlay);
  }

  if (overlayObject.marker) {
    map.value.removeLayer(overlayObject.marker);
  }

  delete overlayStore.overlays[overlayId];
  delete overlayStore.allMarkers[overlayId];

  if (overlayStore.idSelectedOverlay === overlayId) {
    overlayStore.idSelectedOverlay = null;
  }
}

/**
 * AI : Update marker tooltip based on overlay storage status
 */
export function updateMarkerTooltip(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();

  if (!overlayObject.marker) return;

  overlayObject.marker.unbindTooltip();

  const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.isEditMode ? 'edit' : 'view');
  const colorIcon = createColorIcon(markerColor);
  overlayObject.marker.setIcon(colorIcon);

  if (!overlayStore.isEditMode) {
    return;
  }
  // AI : Generate tooltip text based on overlay state
  const isRemoteOverlay = overlayObject?.savedRemotely;
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
  const overlayStore = useOverlayStore();

  if (!map.value || overlayStore.allMarkers[savedOverlay.id]) return;

  const overlayBounds = getOverlayBounds(savedOverlay);
  if (!overlayBounds) return;

  const markerTitle = createMarkerTitle(savedOverlay, savedOverlay.projectId);
  const center = overlayBounds.getCenter();
  const tempOverlayObject = createOverlayObject(savedOverlay);
  const markerColor = getOverlayMarkerColor(tempOverlayObject, overlayStore.isEditMode ? 'edit' : 'view');
  const colorIcon = createColorIcon(markerColor);

  const marker = L.marker(center, {
    title: markerTitle,
    icon: colorIcon
  }).addTo(map.value);

  overlayStore.allMarkers[savedOverlay.id] = marker;
  tempOverlayObject.marker = marker;
  updateMarkerTooltip(tempOverlayObject);
}

function getOverlayBounds(overlay: OverlayObject): L.LatLngBounds | null {
  const overlayStore = useOverlayStore();

  // AI : Priority 1: Check edit mode cache if in edit mode for the most current position
  if (overlayStore.isEditMode) {
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
  if (!overlay.corners || overlay.corners.length !== 4) {
    return null;
  }

  const corners = overlay.corners.map(c => L.latLng(c.lat, c.lng));

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
      const overlayStore = useOverlayStore();

      if (!isManipulating) return;
      isManipulating = false;

      if (updateFrame) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }

      // AI : Final marker position update
      updateMarkerPosition(overlayObject);

      // AI : Update city overlay markers if they are visible
      updateOverlayMarkersColors(toRef(overlayStore, 'overlays'), toRef(overlayStore, 'isEditMode'));
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
    // AI : Get bounds from overlay or construct from corners
    const bounds = overlay.overlay.getBounds() ??
      (overlay.overlay.getCorners()?.length === 4 ? L.latLngBounds(overlay.overlay.getCorners()) : null);

    if (bounds) {
      map.value.flyToBounds(bounds, { padding: [50, 50] as [number, number], duration: 1.5, easeLinearity: 0.25 });
      return true;
    }

    // AI : Fallback to marker position
    if (overlay.marker) {
      map.value.flyTo(overlay.marker.getLatLng(), 18, { duration: 1.5, easeLinearity: 0.25 });
      return true;
    }
  } catch {
    // AI : Error fallback to marker position
    if (overlay.marker) {
      map.value.flyTo(overlay.marker.getLatLng(), 18, { duration: 1.5, easeLinearity: 0.25 });
      return true;
    }
  }
  return false;
}


/**
 * AI : Create a marker for overlays with specified type and color
 */
function createMarker(overlayObject: OverlayObject, projectId: string, markerType: 'new' | 'replacement'): void {
  const overlayStore = useOverlayStore();

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
      overlayStore.idSelectedOverlay = overlayObject.id;
    }
  });

  // AI : Store marker reference
  overlayObject.marker = marker;
  overlayStore.allMarkers[overlayObject.id] = marker;

  // AI : Update marker tooltip with proper styling
  updateMarkerTooltip(overlayObject);
}

/**
 *
 * @param imageUrl
 * @param projectId
 * @param replacesOverlayId
 * @returns the ID of the newly created overlay
 */
export function addOverlay(imageUrl: string, projectId: string, replacesOverlayId?: string) {
  const overlayStore = useOverlayStore();

  // AI : Only allow adding overlays in edit mode
  if (!overlayStore.isEditMode) {
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
    const originalOverlay = overlayStore.overlays[replacesOverlayId];
    overlayObject.caption = `Replacement for ${originalOverlay?.caption ?? 'overlay'}`;
  }

  // Create the overlay
  const newOverlay = createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;
  const element = newOverlay.getElement();
  if (!element) {
    throw new Error('Overlay element not found');
  }

  L.DomEvent.on(element, 'load', () => {
    if (element.complete && element.naturalWidth > 0) {
      overlayObject.overlay = newOverlay;
      overlayObject.corners = newOverlay.getCorners() ?? [];

      // Store reference and initialize
      overlayStore.overlays[id] = overlayObject;

      // AI : Create marker with appropriate color based on replacement status
      if (replacesOverlayId) {
        createMarker(overlayObject, projectId, 'replacement');
      } else {
        createMarker(overlayObject, projectId, 'new');
      }

      // AI : Add to project AFTER storing in overlays to avoid "not found" error
      addOverlayToProjectWithId(projectId, id);

      // AI : Add new overlay to city cache so it persists across zoom changes
      const selectedCity = getSelectedCity();
      if (selectedCity) {
        addNewOverlayToCityCache(overlayObject, selectedCity.id);
      }
    }
  })

  return id;
}

export function undo() {
  applyHistoryAction('undo');
}

export function redo() {
  applyHistoryAction('redo');
}

function applyHistoryAction(action: 'undo' | 'redo') {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) return;

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
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

    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);
  } catch (error) {
    throw new Error(`Failed to ${action} overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function resetImageRatio() {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) {
    throw new Error('No image selected: Please select an image first');
  }

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
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
    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);
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
  const overlayStore = useOverlayStore();
  const { projects } = useProjects();

  if (!map.value) {
    throw new Error('Map not available: Cannot navigate between overlays');
  }

  // Handle case when no overlay is selected
  if (!overlayStore.idSelectedOverlay) {
    return selectFirstOrLastOverlayInAnyProject(direction);
  }

  const currentOverlay = overlayStore.overlays[overlayStore.idSelectedOverlay];

  if (!currentOverlay?.projectId) {
    return false;
  }

  let project = projects.value[currentOverlay.projectId];
  let projectOverlayIds: string[];

  // AI : If project is not in memory, just find overlays with same projectId
  if (!project) {
    projectOverlayIds = Object.values(overlayStore.overlays)
      .filter(overlay => overlay.projectId === currentOverlay.projectId)
      .map(overlay => overlay.id);
  } else {
    projectOverlayIds = project.overlayIds;
  }

  if (projectOverlayIds.length <= 1) {
    return false;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(overlayStore.idSelectedOverlay);
  const step = direction === 'next' ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];

  return selectAndCenterOverlay(newOverlayId);
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
 * AI : Loads an overlay by ID, fetching from backend if needed
 * AI : This function only handles loading/rendering, not navigation
 * @param overlayId - The ID of the overlay to load
 * @returns true if overlay was loaded successfully
 */
export async function loadOverlay(overlayId: string): Promise<boolean | null> {
  const overlayStore = useOverlayStore();

  // AI : Check if overlay is already loaded locally
  if (overlayStore.overlays[overlayId]) {
    return true;
  }

  // AI : Overlay not found locally - fetch from backend
  return withErrorHandling(
    async () => {
      // AI : Fetch overlay and intersecting overlays from backend
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting: true,
      });

      if (!result.overlay) {
        throw new Error('Overlay not found');
      }

      // AI : Render the main overlay
      renderViewModeOverlays([result.overlay as OverlayData], true, false);

      // AI : Render intersecting overlays if they exist
      if (result.intersectingOverlays.length > 0) {
        renderViewModeOverlays(result.intersectingOverlays as OverlayData[], true, false);
      }

      // AI : Verify overlay was successfully loaded
      if (!overlayStore.overlays[overlayId]) {
        throw new Error('Failed to load overlay after fetching');
      }

      return true;
    },
    { errorMessage: 'Failed to load overlay', rethrow: true }
  );
}

/**
 * AI : Navigates to a specific overlay by ID (loads + selects + centers)
 * @param overlayId - The ID of the overlay to navigate to
 * @param centerMap - Whether to center the map on the overlay (defaults to true)
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlay(overlayId: string, centerMap: boolean = true): Promise<boolean> {
  // AI : Load the overlay first
  await loadOverlay(overlayId);

  // AI : Then navigate to it
  return selectAndCenterOverlay(overlayId, centerMap);
}

function selectAndCenterOverlay(overlayId: string, centerMap: boolean = true) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.overlays[overlayId];

  if (!overlay) {
    return false;
  }

  // AI : Select the overlay with proper cleanup
  selectOverlay(overlayId);

  if (overlay.overlay) {
    // Click on the overlay to properly select it and open the toolbar
    const element = overlay.overlay.getElement();

    if (element) {
      element.click();
    }

    if (centerMap && map.value && overlay.overlay) {
      // AI : Wait for overlay to be properly initialized before zooming
      zoomToOverlayBounds(overlay);
    }
    return true;
  } else if (overlay.marker && centerMap && map.value) {
    // AI : If overlay is not loaded yet but marker exists
    map.value.setView(overlay.marker.getLatLng(), 18);
    return true;
  }
  return false;
}

export function updateTooltipText() {
  const overlayStore = useOverlayStore();
  const { projects } = useProjects();

  if (!overlayStore.idSelectedOverlay) return;

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  if (!overlayObject?.overlay) return;

  if (overlayObject.projectId) {
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
  const overlayStore = useOverlayStore();
  const { projects } = useProjects();

  const overlayObject = overlayStore.overlays[id];
  if (!overlayObject) return;

  // AI : Update project if overlay belongs to one
  if (overlayObject.projectId) {
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
  const overlayStore = useOverlayStore();

  const overlayObject = overlayStore.overlays[id];
  if (!overlayObject) return;

  overlayObject.caption = info.caption ?? null;

  updateTooltipText();

  // AI : Save only the specific overlay being updated, not all overlays
  updateMarkerTooltip(overlayObject);
}

export const infoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: 'pi pi-info-circle',
      tooltip: 'Info'
    },
    subToolbar: new L.Toolbar2({
      actions: [L.EditAction.extend({
        options: {
          toolbarIcon: {
            tooltip: "Info",
            className: "more-info-popup",
          },
        },
        initialize: function () {
          L.EditAction.prototype.initialize?.apply(this, Array.from(arguments));
        }
      })],
    })
  },
  // very fragile code but necessary to plug into the leaflet toolbar. If you have a better idea, please contribute!
  addHooks() {
    const link = this._link;
    const overlayStore = useOverlayStore();

    if (!overlayStore.idSelectedOverlay) {
      return;
    }

    // AI : Check if currently open using store state and DOM state
    const teleportTargetExists = !!this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
    const isCurrentlyOpen = overlayStore.showInfoPopup && teleportTargetExists;

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
      if (teleportTargetExists && !overlayStore.showInfoPopup) {
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
        if (overlayStore.idSelectedOverlay) {
          overlayStore.showInfoPopupForOverlay(overlayStore.idSelectedOverlay);
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
    focusCameraToOverlay('previous');
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
    focusCameraToOverlay('next');
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
    const overlayStore = useOverlayStore();
    if (!overlayStore.idSelectedOverlay) {
      return;
    }
    if (confirm('Are you sure you want to delete this overlay from local storage?')) {
      deleteOverlayButtonPressed(overlayStore.idSelectedOverlay);
      overlayStore.idSelectedOverlay = null;
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
    const overlayStore = useOverlayStore();
    if (!overlayStore.idSelectedOverlay) {
      return;
    }

    // AI : Request overlay replacement using the store
    overlayStore.requestOverlayReplacement(overlayStore.idSelectedOverlay);
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
