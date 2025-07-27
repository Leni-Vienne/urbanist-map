import L from "leaflet";
import { map } from '@composables/core/useMap';
import { overlays, idSelectedOverlay, updateMarkerPosition, saveToHistory, createOverlay, isEditMode, removeOverlay, allMarkers, updateMarkerTooltip, renderViewModeOverlays } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useProjects, addOverlayToProjectWithId } from '@composables/project/useProjects';
import type { OverlayObject, CDNOverlayData, MarkerColor } from '@types';
import { router } from '../../router';
import { createColorIcon } from '@composables/ui/colorMarkers';
import { trpc } from '../../client';
import type { BackendOverlay } from '../../types/api';
import { updateCachedOverlayData } from '@composables/map/useCityMarkers';

const toast = useToast();

// AI : Helper function to transform backend overlay to CDN format
function transformBackendOverlayToCDN(backendOverlay: BackendOverlay): CDNOverlayData {
  return {
    id: backendOverlay.id,
    filename: backendOverlay.filename,
    caption: backendOverlay.caption ?? undefined,
    projectId: backendOverlay.projectId,
    replacesOverlayId: backendOverlay.replacesOverlayId ?? undefined,
    project: backendOverlay.projectName ? {
      id: backendOverlay.projectId ?? '',
      title: backendOverlay.projectName,
      description: null,
      status: 'approved' as const,
      ownerId: null,
      cityId: null,
      metadata: null,
      sourceUrl: null,
      startDate: null,
      endDate: null,
      latestUpdateOn: null,
      createdAt: null,
      updatedAt: new Date(),
      city: backendOverlay.cityName ? {
        id: '',
        name: backendOverlay.cityName,
        countryCode: '',
        coordinates: { x: 0, y: 0 },
        createdAt: null,
        updatedAt: new Date()
      } : null
    } : null,
    corners: [
      { lat: backendOverlay.topLeftLat, lng: backendOverlay.topLeftLng },
      { lat: backendOverlay.topRightLat, lng: backendOverlay.topRightLng },
      { lat: backendOverlay.bottomRightLat, lng: backendOverlay.bottomRightLng },
      { lat: backendOverlay.bottomLeftLat, lng: backendOverlay.bottomLeftLng }
    ],
    centroid: {
      lat: backendOverlay.centroid.y,
      lng: backendOverlay.centroid.x
    },
    distance: 0,
    createdAt: backendOverlay.createdAt,
  };
}

// AI : Helper function to create new overlay with proper Drizzle schema structure
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  const filename = imageUrl.split('/').pop() ?? '';
  
  return {
    // AI : Core Drizzle schema fields
    id,
    filename,
    caption: null,
    status: 'pending',
    projectId,
    authorId: null,
    replacesOverlayId: null,
    metadata: null,
    // AI : Use 0 for coordinates to indicate they need to be set by leaflet-distortableimage
    topLeftLat: 0,
    topLeftLng: 0,
    topRightLat: 0,
    topRightLng: 0,
    bottomRightLat: 0,
    bottomRightLng: 0,
    bottomLeftLat: 0,
    bottomLeftLng: 0,
    centroid: { x: 0, y: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    // AI : Frontend-specific fields
    imageUrl,
    history: [],
    redoStack: [],
    // AI : Runtime properties
    overlay: null,
    marker: null,
    whitePixelsHidden: false,
    isFlipped: false,
    currentResolution: imageUrl,
    corners: [],
    isModified: false, // AI : New overlays start as not modified
  };
}

// AI : Helper function to wait for overlay corners to be ready
async function waitForOverlayReady(overlay: OverlayObject): Promise<boolean> {
  if (!overlay.overlay) return false;
  
  return new Promise(resolve => {
    const checkOverlayReady = () => {
      try {
        const corners = overlay.overlay?.getCorners();
        if (corners && corners.length === 4) {
          resolve(true);
        } else {
          setTimeout(checkOverlayReady, 50);
        }
      } catch {
        // AI : If corners aren't ready, wait a bit more
        setTimeout(checkOverlayReady, 50);
      }
    };
    checkOverlayReady();
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
    
    // AI : Update cached overlay data with new corners
    if (newCorners && newCorners.length === 4) {
      updateCachedOverlayData(overlayObject.id, newCorners);
    }
    
    // AI : Update marker tooltip after corners are saved
    updateMarkerTooltip(overlayObject);
  }
  // AI : No local storage - data is managed in memory and published to backend when user saves
  console.log('AI : Overlay corners updated in memory:', overlayObject.id);
}

// AI : Helper function to update marker position and save overlay data
function updateMarkerAndSaveOverlay(overlayObject: OverlayObject): void {
  updateMarkerPosition(overlayObject);
  saveOverlayWithCurrentCorners(overlayObject);
}

// AI : Helper function to center map on overlay with proper waiting and error handling
async function centerMapOnOverlay(overlay: OverlayObject): Promise<boolean> {
  if (!overlay.overlay) return false;
  
  await waitForOverlayReady(overlay);
  return zoomToOverlayBounds(overlay);
}

/**
 * AI : Create a marker for overlays with specified type and color
 */
function createMarker(overlayObject: any, projectId: string, markerType: 'new' | 'replacement'): void {
  if (!map.value) return;
  
  // AI : Use current map center as initial marker position
  const center = map.value.getCenter();
  
  // AI : Determine marker title based on type
  const baseTitle = markerType === 'replacement' ? 'Replacement Overlay' : 'New Overlay';
  let markerTitle = baseTitle;
  
  if (projectId) {
    const { projects } = useProjects();
    if (projects.value[projectId]) {
      const project = projects.value[projectId];
      const captionPart = overlayObject.caption ? ` - ${overlayObject.caption}` : '';
      markerTitle = `${project.name} - ${baseTitle}${captionPart}`;
    }
  }

  // AI : Determine marker color based on type
  const markerColor = markerType === 'replacement' ? 'violet' : getMarkerColorForEditMode();
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
 * AI : Create a violet marker for replacement overlays
 */
function createReplacementMarker(overlayObject: any, projectId: string): void {
  createMarker(overlayObject, projectId, 'replacement');
}


export async function addOverlay(imageUrl: string, projectId: string, replacesOverlayId?: string) {
  // AI : Only allow adding overlays in edit mode
  if (!isEditMode.value) {
    console.warn('Cannot add overlay in view mode');
    return;
  }
  
  if (!map.value) return;
  if (!projectId) {
    toast.add({ severity: 'error', summary: 'Project Required', detail: 'A project must be selected to add an overlay', life: 3000 });
    return;
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
  const newOverlay = await createOverlay(imageUrl, overlayObject);
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
  
  await addOverlayToProjectWithId(projectId, id);
  
  // AI : Select the new overlay (important for replacement overlays)
  idSelectedOverlay.value = id;
  
  return id;
}

// AI : Create marker for new overlay at map center (before image loads)
function createMarkerForNewOverlay(overlayObject: any, projectId: string): void {
  createMarker(overlayObject, projectId, 'new');
}

// AI : Helper function to determine marker color (simplified - no storage state)
function getMarkerColorForEditMode(): MarkerColor {
  // AI : All overlays are local in edit mode, use consistent color
  return 'blue';
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
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  const isUndo = action === 'undo';
  
  if ((isUndo && history.length <= 1) || (!isUndo && redoStack.length === 0)) {
    toast.add({
      severity: 'warn',
      summary: `Cannot ${action}`,
      detail: `No more actions to ${action}`,
      life: 3000
    });
    return;
  }

  if (isUndo) {
    // AI : For undo: move current state to redo stack and apply previous state
    const currentState = history.pop()!;
    redoStack.push(currentState);
    const previousState = history[history.length - 1];
    (overlay as L.DistortableImageOverlay).setCorners(previousState);
  } else {
    // AI : For redo: move state from redo stack to history and apply it
    const stateToRestore = redoStack.pop()!;
    history.push(stateToRestore);
    (overlay as L.DistortableImageOverlay).setCorners(stateToRestore);
  }

  updateMarkerAndSaveOverlay(overlayObject);
}

export function resetImageRatio() {
  if (!idSelectedOverlay.value) {
    toast.add({ severity: 'warn', summary: 'No image selected', detail: 'Please select an image first', life: 3000 });
    return;
  }

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  const img = new Image();
  img.onload = () => {
    if (!overlayObject.overlay || !map.value) return;
    
    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners?.length || currentCorners.length !== 4) return;
    
    // AI : Save state before applying ratio fix
    saveToHistory(overlayObject);
    
    const { originalRatio: _originalRatio, newDimensions, cornersInfo } = calculateRatioFixParameters(
      img.naturalWidth / img.naturalHeight,
      currentCorners
    );
    
    if (!cornersInfo) return;
    
    applyImageRatioFix(overlayObject, cornersInfo, newDimensions);
    handleFlipIfNeeded(overlayObject);
    updateMarkerAndSaveOverlay(overlayObject);
  };

  img.src = overlayObject.imageUrl ?? (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

function calculateRatioFixParameters(originalRatio: number, currentCorners: any[]) {
  if (!map.value) return {};
  
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

function applyImageRatioFix(overlayObject: any, cornersInfo: any, dimensions: any) {
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

function handleFlipIfNeeded(overlayObject: any) {
  if (!overlayObject.overlay) return;
  
  if (overlayObject.isFlipped) {
    // This is the second click, apply horizontal mirroring
    overlayObject.isFlipped = false;
    const corners = overlayObject.overlay.getCorners();
    
    // Swap corners for horizontal mirroring: NW<->NE and SW<->SE
    const mirroredCorners = [corners[1], corners[0], corners[3], corners[2]];
    overlayObject.overlay.setCorners(mirroredCorners);
    
    toast.add({
      severity: 'success',
      summary: 'Image ratio reset and mirrored',
      detail: 'Image has been reset to original ratio and mirrored horizontally',
      life: 5000
    });
  } else {
    // First click, just set the flag for potential mirroring on next click
    overlayObject.isFlipped = true;
    
    toast.add({
      severity: 'success',
      summary: 'Image ratio reset',
      detail: 'Click again to mirror the image horizontally',
      life: 5000
    });
  }
}

/**
 * AI : Navigates between overlays in the current project based on direction
 * @param direction - Either 'next' or 'previous' to determine navigation direction
 * @returns boolean indicating whether navigation was successful
 */
export async function focusCameraToOverlay(direction: 'next' | 'previous'): Promise<boolean> {
  if (!map.value) {
    toast.add({ severity: 'warn', summary: 'Map not available', detail: 'Cannot navigate between overlays', life: 3000 });
    return false;
  }
  
  // Handle case when no overlay is selected
  if (!idSelectedOverlay.value) {
    return await selectFirstOrLastOverlayInAnyProject(direction);
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
    toast.add({ severity: 'info', summary: 'Navigation', detail: 'No other overlays in this project', life: 3000 });
    return false;
  }
  
  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(idSelectedOverlay.value);
  const step = direction === 'next' ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];
  
  return await selectAndCenterOverlay(newOverlayId, newIndex, projectOverlayIds.length);
}

async function selectFirstOrLastOverlayInAnyProject(direction: 'next' | 'previous'): Promise<boolean> {
  const { projects } = useProjects();
  const projectIds = Object.keys(projects.value);
  if (!projectIds.length) {
    toast.add({ severity: 'warn', summary: 'No projects', detail: 'Please create a project first', life: 3000 });
    return false;
  }
  
  for (const projectId of projectIds) {
    const project = projects.value[projectId];
    if (project.overlayIds.length > 0) {
      // Select first overlay for 'next', last overlay for 'previous'
      const index = direction === 'next' ? 0 : project.overlayIds.length - 1;
      const overlayId = project.overlayIds[index];
      
      if (await selectAndCenterOverlay(overlayId)) {
        toast.add({
          severity: 'info',
          summary: 'Navigation',
          detail: `Selected ${direction === 'next' ? 'first' : 'last'} overlay in project ${project.name}`,
          life: 3000
        });
        return true;
      }
    }
  }
  
  toast.add({ severity: 'warn', summary: 'No overlays', detail: 'No overlays found in any project', life: 3000 });
  return false;
}

/**
 * AI : Navigates directly to a specific overlay by ID
 * @param overlayId - The ID of the overlay to navigate to
 * @param centerMap - Whether to center the map on the overlay (defaults to true)
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlay(overlayId: string, centerMap: boolean = true): Promise<boolean> {
  if (!map.value) {
    toast.add({ severity: 'warn', summary: 'Map not available', detail: 'Cannot navigate to overlay', life: 3000 });
    return false;
  }
  
  let targetOverlay = overlays.value[overlayId];
  
  // AI : If overlay is not loaded locally, fetch from backend
  if (!targetOverlay) {
    try {
      toast.add({ severity: 'info', summary: 'Loading overlay', detail: 'Fetching overlay from server...', life: 2000 });
      
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting: true,
      });
      
      if (!result.overlay) {
        toast.add({ severity: 'error', summary: 'Overlay not found', detail: 'The requested overlay could not be found on the server', life: 3000 });
        return false;
      }
      
      // AI : Transform backend overlay to CDN format
      const cdnOverlay = transformBackendOverlayToCDN(result.overlay);
      
      await renderViewModeOverlays([cdnOverlay], true, false);
      
      // AI : Also render intersecting overlays if they exist
      if (result.intersectingOverlays && result.intersectingOverlays.length > 0) {
        console.log(`AI : Rendering ${result.intersectingOverlays.length} intersecting overlays`);
        
        const intersectingCdnOverlays = result.intersectingOverlays.map(transformBackendOverlayToCDN);
        
        await renderViewModeOverlays(intersectingCdnOverlays, true, false);
        
        toast.add({
          severity: 'info',
          summary: 'Overlays Loaded',
          detail: `Loaded main overlay and ${result.intersectingOverlays.length} intersecting overlays`,
          life: 3000
        });
      }
      
      targetOverlay = overlays.value[overlayId];
      
      if (!targetOverlay) {
        toast.add({ severity: 'error', summary: 'Loading failed', detail: 'Failed to load overlay after fetching from server', life: 3000 });
        return false;
      }
      
    } catch (error) {
      console.error('Error fetching overlay:', error);
      toast.add({ severity: 'error', summary: 'Loading failed', detail: 'Failed to fetch overlay from server', life: 3000 });
      return false;
    }
  }
  
  // AI : Select the overlay and update URL
  idSelectedOverlay.value = overlayId;
  updateUrlWithOverlayId(overlayId);
  
  // AI : Center map if requested
  if (centerMap && targetOverlay.overlay) {
    await centerMapOnOverlay(targetOverlay);
  }
  
  // AI : Click on overlay to select it
  if (targetOverlay.overlay) {
    const element = targetOverlay.overlay.getElement();
    if (element) {
      element.click();
    }
    return true;
  }
  
  return false;
}

async function selectAndCenterOverlay(overlayId: string, index?: number, total?: number, centerMap: boolean = true): Promise<boolean> {
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
      const zoomSuccess = await centerMapOnOverlay(overlay);
      
      if (zoomSuccess) {
        showNavigationToast(overlay, index, total);
      }
    }
    return true;  
  } else if (overlay.marker && centerMap && map.value) {
    // AI : If overlay is not loaded yet but marker exists
    map.value.setView(overlay.marker.getLatLng(), 18);
    return true;
  }
  
  toast.add({
    severity: 'warn',
    summary: 'Navigation issue',
    detail: 'The overlay exists but could not be shown on the map',
    life: 3000
  });
  return false;
}

/**
 * AI : Show appropriate toast message when navigating to overlay
 */
function showNavigationToast(overlay: OverlayObject, index?: number, total?: number): void {
  if (index !== undefined && total !== undefined) {
    const captionSuffix = overlay.caption ? ` (${overlay.caption})` : '';
    const detailMessage = `Moved to overlay ${index + 1} of ${total}${captionSuffix}`;
    toast.add({
      severity: 'info',
      summary: 'Navigation',
      detail: detailMessage,
      life: 3000
    });
  } else if (overlay.caption) {
    toast.add({
      severity: 'info',
      summary: 'Navigation',
      detail: `Navigated to overlay: ${overlay.caption}`,
      life: 3000
    });
  }
}

/**
 * AI : Updates the URL with the current overlay ID using path parameter
 * @param overlayId - The ID of the overlay to include in the URL
 */
function updateUrlWithOverlayId(overlayId: string): void {
  try {
    router.replace(`/overlay/${overlayId}`);
  } catch (error) {
    console.error('AI: Error updating URL with overlay ID:', error);
  }
}

/**
 * AI : Centers the map view on the next overlay in the current project.
 * Wrapper for focusCameraToOverlay('next')
 */
export async function goToNextOverlay() {
  await focusCameraToOverlay('next');
}

/**
 * AI : Centers the map view on the previous overlay in the current project.
 * Wrapper for focusCameraToOverlay('previous')
 */
export async function goToPreviousOverlay() {
  await focusCameraToOverlay('previous');
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
      overlayObject.overlay!.bindTooltip(tooltipText, { permanent: true, direction: 'top' }).openTooltip();
    }
  } else {
    overlayObject.overlay.bindTooltip('Overlay', { permanent: true, direction: 'top' }).openTooltip();
  }
}

export async function deleteOverlay(id: string) {
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
      
      console.log('AI : Overlay removed from project locally (no backend call):', id, 'from project:', overlayObject.projectId);
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