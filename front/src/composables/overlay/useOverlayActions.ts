import L from "leaflet";
import { map } from '@composables/core/useMap';
import { overlays, idSelectedOverlay, updateMarkerPosition, saveToHistory, createOverlay, isEditMode, removeOverlay, allMarkers, updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { saveOverlay, deleteOverlay as deleteOverlayFromDatabase } from '@composables/core/useDatabase';
import { useToast } from '@composables/ui/useToast';
import { projects, addOverlayToProjectWithId } from '@composables/project/useProjects';
import type { StoredOverlayData, OverlayObject } from '@types';
import { router } from '../../router';
import { createColorIcon } from '@composables/ui/colorMarkers';

const toast = useToast();

// AI : Helper function to create StoredOverlayData from OverlayObject
function createStoredOverlayData(overlayObject: OverlayObject): StoredOverlayData {
  return {
    id: overlayObject.id,
    imageUrl: overlayObject.imageUrl,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    projectId: overlayObject.projectId,
    caption: overlayObject.caption,
    savedRemotely: overlayObject.savedRemotely ?? false,
    filename: overlayObject.filename ?? overlayObject.imageUrl.split('/').pop() ?? '',
    metadata: overlayObject.metadata ?? null,
    status: overlayObject.status ?? 'pending',
    authorId: overlayObject.authorId ?? null,
    topLeftLat: overlayObject.topLeftLat ?? 0,
    topLeftLng: overlayObject.topLeftLng ?? 0,
    topRightLat: overlayObject.topRightLat ?? 0,
    topRightLng: overlayObject.topRightLng ?? 0,
    bottomRightLat: overlayObject.bottomRightLat ?? 0,
    bottomRightLng: overlayObject.bottomRightLng ?? 0,
    bottomLeftLat: overlayObject.bottomLeftLat ?? 0,
    bottomLeftLng: overlayObject.bottomLeftLng ?? 0,
    centroid: overlayObject.centroid ?? { x: 0, y: 0 },
    createdAt: overlayObject.createdAt ?? new Date(),
    updatedAt: new Date()
  };
}

// AI : Helper function to save overlay with updated corners
function saveOverlayWithCurrentCorners(overlayObject: OverlayObject): void {
  if (overlayObject.overlay) {
    overlayObject.corners = overlayObject.overlay.getCorners();
  }
  
  const storedOverlay = createStoredOverlayData(overlayObject);
  saveOverlay(storedOverlay);
}

export async function addOverlay(imageUrl: string, projectId: string) {
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
  
  // Create basic overlay object  
  const overlayObject = {
    id,
    imageUrl,
    overlay: null,
    marker: null,
    history: [],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: false,
    corners: [], // AI : Temporary field for backward compatibility - will be removed
    projectId,
    caption: null,
    whitePixelsHidden: false,
    isFlipped: false,
    currentResolution: imageUrl,
    savedRemotely: false, // AI : New overlays don't exist on server yet
    // AI : Required fields from Drizzle schema
    filename: imageUrl.split('/').pop() ?? '',
    metadata: null,
    status: 'pending' as const, // AI : Default status for new overlays
    authorId: null, // AI : No user authentication system yet
    // AI : Initialize corner coordinates as undefined so applyOverlayCorners uses Priority 3 (natural positioning)
    topLeftLat: undefined as any,
    topLeftLng: undefined as any,
    topRightLat: undefined as any,
    topRightLng: undefined as any,
    bottomRightLat: undefined as any,
    bottomRightLng: undefined as any,
    bottomLeftLat: undefined as any,
    bottomLeftLng: undefined as any,
    centroid: { x: 0, y: 0 }, // AI : Will be calculated when overlay loads
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Create the overlay
  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  // Store reference and initialize
  overlays.value[id] = overlayObject;
  
  // AI : Create marker immediately when overlay is created, not waiting for image load
  createMarkerForNewOverlay(overlayObject, projectId);
  
  // AI : Don't set up custom load handler - let the existing setupOverlayLoadHandler handle it
  // The existing system in useOverlay.ts will call onOverlayLoaded which handles all initialization
  
  await addOverlayToProjectWithId(projectId, id);
  
  return id;
}

// AI : Create marker for new overlay at map center (before image loads)
function createMarkerForNewOverlay(overlayObject: any, projectId: string) {
  if (!map.value) return;
  
  // AI : Use current map center as initial marker position
  const center = map.value.getCenter();
  
  // AI : Use unified marker creation system with proper color and tooltip handling
  let markerTitle = 'New Overlay';
  if (projectId && projects.value[projectId]) {
    const project = projects.value[projectId];
    const captionPart = overlayObject.caption ? ` - ${overlayObject.caption}` : '';
    markerTitle = `${project.name} - New Overlay${captionPart}`;
  }

  // AI : Create marker with proper color based on storage status
  const markerColor = getMarkerColorForEditMode(overlayObject);
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
  
  overlayObject.marker = marker;
  allMarkers.value[overlayObject.id] = marker;
  
  // AI : Update marker tooltip with proper styling
  updateMarkerTooltip(overlayObject);
}

// AI : Helper function to determine marker color in edit mode
function getMarkerColorForEditMode(overlayObject: OverlayObject): 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black' {
  const { savedRemotely, alreadyStored } = overlayObject;

  if (savedRemotely && !alreadyStored) {
    return 'green'; // AI : Remote overlay not stored locally
  } else if (savedRemotely && alreadyStored) {
    return 'orange'; // AI : Remote overlay with local copy
  } else if (!savedRemotely) {
    return 'red'; // AI : Local only overlay (new or existing local overlay)
  }

  // AI : Fallback to blue for any edge cases
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
  
  const sourceStack = isUndo ? history : redoStack;
  const targetStack = isUndo ? redoStack : history;
  
  if ((isUndo && history.length <= 1) || (!isUndo && redoStack.length === 0)) {
    toast.add({
      severity: 'warn',
      summary: `Cannot ${action}`,
      detail: `No more actions to ${action}`,
      life: 3000
    });
    return;
  }

  const state = sourceStack.pop()!;
  targetStack.push(state);

  const newState = isUndo ? sourceStack[sourceStack.length - 1] : state;
  (overlay as L.DistortableImageOverlay).setCorners(newState);

  updateMarkerPosition(overlayObject);
  // AI : Save only the specific overlay being updated, not all overlays
  saveOverlayWithCurrentCorners(overlayObject);
}

export async function toggleWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  overlayObject.whitePixelsHidden = !overlayObject.whitePixelsHidden;
  
  try {
    const imgElement = overlayObject.overlay.getElement();
    if (!imgElement) return;
    
    const imgSrc = overlayObject.whitePixelsHidden ? 
      (overlayObject.imageUrl ?? imgElement.src) : 
      imgElement.src;
    
    if (overlayObject.whitePixelsHidden) {
      const processedImage = await processImageToHideWhitePixels(imgSrc);
      if (processedImage) {
        imgElement.src = processedImage;
      }
    } else {
      imgElement.src = overlayObject.imageUrl ?? overlayObject.currentResolution ?? '';
    }
    
    toast.add({
      severity: 'info',
      summary: overlayObject.whitePixelsHidden ? 
        'Background pixels have been hidden' : 
        'Background pixels are now visible',
      life: 2000
    });
  } catch (error) {
    console.error('Error toggling white pixels:', error);
  }
}

async function processImageToHideWhitePixels(imgSrc: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // AI : Make white pixels transparent
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];
        
        // check if the pixel is a gray shade (which is likely a background pixel)
        if (r === g && g === b && alpha > 0) {
          data[i + 3] = 0;  // makes the pixel transparent
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL());
    };
    
    img.onerror = () => resolve(null);
    img.src = imgSrc;
  });
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
    
    const { originalRatio: _originalRatio, newDimensions, cornersInfo } = calculateRatioFixParameters(
      img.naturalWidth / img.naturalHeight,
      currentCorners
    );
    
    if (!cornersInfo) return;
    
    applyImageRatioFix(overlayObject, cornersInfo, newDimensions);
    handleFlipIfNeeded(overlayObject);
    // Save state
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    
    // AI : Save only the specific overlay being updated, not all overlays
    saveOverlayWithCurrentCorners(overlayObject);
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
export async function navigateOverlay(direction: 'next' | 'previous'): Promise<boolean> {
  if (!map.value) {
    toast.add({ severity: 'warn', summary: 'Map not available', detail: 'Cannot navigate between overlays', life: 3000 });
    return false;
  }
  
  // Handle case when no overlay is selected
  if (!idSelectedOverlay.value) {
    return selectFirstOrLastOverlayInAnyProject(direction);
  }

  const currentOverlay = overlays.value[idSelectedOverlay.value];
  
  if (!currentOverlay?.projectId) {
    return false;
  }
  
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
  
  return selectAndCenterOverlay(newOverlayId, newIndex, projectOverlayIds.length);
}

function selectFirstOrLastOverlayInAnyProject(direction: 'next' | 'previous'): boolean {
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
      
      if (selectAndCenterOverlay(overlayId)) {
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
export function navigateToOverlay(overlayId: string, centerMap: boolean = true): boolean {
  if (!map.value) {
    toast.add({ severity: 'warn', summary: 'Map not available', detail: 'Cannot navigate to overlay', life: 3000 });
    return false;
  }
  
  const targetOverlay = overlays.value[overlayId];
  if (!targetOverlay) {
    toast.add({ severity: 'warn', summary: 'Overlay not found', detail: 'The requested overlay could not be found', life: 3000 });
    return false;
  }
  
  // Select the overlay and update URL
  idSelectedOverlay.value = overlayId;
  updateUrlWithOverlayId(overlayId);
  
  return selectAndCenterOverlay(overlayId, undefined, undefined, centerMap);
}

function selectAndCenterOverlay(overlayId: string, index?: number, total?: number, centerMap: boolean = true): boolean {
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
    
    if (centerMap) {
      const bounds = overlay.overlay.getBounds();
      const center = bounds.getCenter();
      // AI : Center on overlay without changing zoom level
      map.value!.setView(center, map.value!.getZoom());
      
      // Show appropriate toast message
      showNavigationToast(overlay, index, total);
    }
    return true;  
  } else if (overlay.marker && centerMap && map.value) {
    // AI : If overlay is not loaded yet but marker exists
    map.value.setView(overlay.marker.getLatLng(), map.value.getZoom());
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
 * Wrapper for navigateOverlay('next')
 */
export async function goToNextOverlay() {
  await navigateOverlay('next');
}

/**
 * AI : Centers the map view on the previous overlay in the current project.
 * Wrapper for navigateOverlay('previous')
 */
export async function goToPreviousOverlay() {
  await navigateOverlay('previous');
}

export function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject?.overlay) return;

  if (overlayObject.projectId) {
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
  if (overlayObject.projectId && projects.value[overlayObject.projectId]) {
    const project = projects.value[overlayObject.projectId];
    // Update local reference only - no backend calls during editing
    project.overlayIds = project.overlayIds.filter(overlayId => overlayId !== id);
    project.updatedAt = new Date();
    
    console.log('AI : Overlay removed from project locally (no backend call):', id, 'from project:', overlayObject.projectId);
  }
  removeOverlay(id);
  deleteOverlayFromDatabase(id);
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  overlayObject.caption = info.caption ?? null;
  
  updateTooltipText();
  
  // AI : Save only the specific overlay being updated, not all overlays
  saveOverlayWithCurrentCorners(overlayObject);
}
