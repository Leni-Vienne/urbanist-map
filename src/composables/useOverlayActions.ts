import { map, calculateScreenCoverage } from './useMap';
import { overlays, idSelectedOverlay, updateMarkerPosition, saveToHistory, createOverlay, updateOverlayImage } from './useOverlay';
import { saveOverlay, deleteOverlay as deleteOverlayFromDatabase } from './useDatabase';
import { generateImageResolutions, getImageUrlForCoverage } from './useImageResizer';
import type { ProjectInfo, ImageResolutions } from '../types';
import { useToast } from './useToast';
import { debounce } from '../utils';

const toast = useToast();

/**
 * Add a new overlay to the map
 */
export async function addOverlay(imageUrl: string) {
  if (!map.value) return;

  const id = crypto.randomUUID();
  
  // Generate different resolution versions of the image
  const imageResolutions = await generateImageResolutions(imageUrl);
  
  const overlayObject = {
    id,
    imageUrl,
    imageResolutions,
    overlay: null,
    marker: null,
    history: [],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: false,
    corners: [],
    info: {
      projectName: '',
      sourceLink: '',
      startDate: null,
      endDate: null,
      budget: 0
    },
    whitePixelsHidden: false,
    currentResolution: imageUrl,
  };

  // Create the overlay with original resolution initially
  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  overlays.value[id] = overlayObject;
  updateTooltipText();
  
  // Update to appropriate resolution once overlay is loaded
  setTimeout(updateOverlayToAppropriateResolution(overlayObject), 100);
}

/**
 * Update an overlay to its appropriate resolution based on screen coverage
 */
function updateOverlayToAppropriateResolution(overlayObject) {
  return () => {
    if (!overlayObject.overlay || !overlayObject.imageResolutions) return;
    
    const bounds = overlayObject.overlay.getBounds();
    const coveragePercent = calculateScreenCoverage(bounds);
    const appropriateImageUrl = getImageUrlForCoverage(overlayObject.imageResolutions, coveragePercent);
    
    if (appropriateImageUrl && appropriateImageUrl !== overlayObject.currentResolution) {
      updateOverlayImage(overlayObject, appropriateImageUrl);
      overlayObject.currentResolution = appropriateImageUrl;
    }
  };
}

/**
 * Undo the last action on the selected overlay
 */
export function undo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (history.length <= 1) {
    toast.add({
      severity: 'warn',
      summary: 'Cannot undo',
      detail: 'No more actions to undo',
      life: 3000
    });
    return;
  }

  // Move current state to redo stack
  const currentState = history.pop()!;
  redoStack.push(currentState);

  // Apply previous state
  const previousState = history[history.length - 1];
  (overlay as any).setCorners(previousState);

  updateMarkerPosition(overlayObject);
  saveImageAndPosition();
}

/**
 * Redo the last undone action on the selected overlay
 */
export function redo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (redoStack.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Cannot redo',
      detail: 'No more actions to redo',
      life: 3000
    });
    return;
  }

  // Get the next state from redo stack
  const nextState = redoStack.pop()!;
  history.push(nextState);

  // Apply the state
  (overlay as any).setCorners(nextState);

  updateMarkerPosition(overlayObject);
  saveImageAndPosition();
}

/**
 * Toggle white pixels visibility for the selected overlay
 */
export async function toggleWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  overlayObject.whitePixelsHidden = !overlayObject.whitePixelsHidden;
  
  try {
    const imgElement = overlayObject.overlay.getElement();
    if (!imgElement) return;
    
    // Get source image either from original URL or current src
    const imgSrc = overlayObject.whitePixelsHidden ? 
      (overlayObject.imageUrl || imgElement.src) : 
      imgElement.src;
    
    if (overlayObject.whitePixelsHidden) {
      // Process the image to hide white pixels
      const processedImage = await processImageToHideWhitePixels(imgSrc);
      if (processedImage) {
        imgElement.src = processedImage;
      }
    } else {
      // Restore original image
      imgElement.src = overlayObject.imageUrl || overlayObject.currentResolution || '';
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

/**
 * Process an image to make white pixels transparent
 */
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
      
      // Make white pixels transparent
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];
        
        if (r === g && g === b && alpha > 0) {
          data[i + 3] = 0;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL());
    };
    
    img.onerror = () => resolve(null);
    img.src = imgSrc;
  });
}

/**
 * Reset the image ratio to its original proportions
 */
export function resetImageRatio() {
  if (!idSelectedOverlay.value) {
    toast.add({
      severity: 'warn',
      summary: 'No image selected',
      detail: 'Please select an image first',
      life: 3000
    });
    return;
  }

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  const img = new Image();
  img.onload = () => {
    if (!overlayObject.overlay || !map.value) return;

    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners || currentCorners.length !== 4) return;

    // Calculate center point
    const center = {
      lat: (currentCorners[0].lat + currentCorners[2].lat) / 2,
      lng: (currentCorners[0].lng + currentCorners[2].lng) / 2
    };

    // Calculate current dimensions in pixels
    const bounds = overlayObject.overlay.getBounds();
    const northEast = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const southWest = map.value.latLngToContainerPoint(bounds.getSouthWest());
    const currentWidthPx = Math.abs(northEast.x - southWest.x);
    const currentHeightPx = Math.abs(northEast.y - southWest.y);

    // Calculate new dimensions maintaining the original aspect ratio
    const originalRatio = img.naturalWidth / img.naturalHeight;
    let newWidth, newHeight;
    
    if (currentWidthPx / currentHeightPx > originalRatio) {
      newHeight = currentHeightPx;
      newWidth = newHeight * originalRatio;
    } else {
      newWidth = currentWidthPx;
      newHeight = newWidth / originalRatio;
    }

    // Calculate new corners based on center point and new dimensions
    const centerPoint = map.value.latLngToContainerPoint(center);
    const halfWidth = newWidth / 2;
    const halfHeight = newHeight / 2;

    const newCorners = [
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y - halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y - halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y + halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y + halfHeight])
    ];

    // Apply new corners and save state
    overlayObject.overlay.setCorners(newCorners);
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    saveImageAndPosition();

    toast.add({
      severity: 'success',
      summary: 'Image ratio reset',
      detail: 'The image proportions have been restored',
      life: 3000
    });
  };

  img.src = overlayObject.imageUrl || (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

/**
 * Update the tooltip text for the selected overlay
 */
export function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  const projectName = overlayObject.info?.projectName || 'No Project Name';
  overlayObject.overlay.bindTooltip(projectName, { permanent: true, direction: 'top' }).openTooltip();
}

/**
 * Save all overlays' positions and data to the database
 */
export function saveImageAndPosition() {
  Object.values(overlays.value).forEach(overlayObj => {
    // Ensure we use the most recent coordinates
    if (overlayObj.overlay) {
      overlayObj.corners = overlayObj.overlay.getCorners();
    }
    
    // Create a serializable object for storage
    const savedOverlay = {
      id: overlayObj.id,
      imageUrl: overlayObj.imageUrl,
      imageResolutions: overlayObj.imageResolutions,
      corners: overlayObj.corners,
      history: overlayObj.history,
      redoStack: overlayObj.redoStack,
      info: overlayObj.info || {
        projectName: '',
        sourceLink: '',
        startDate: null,
        endDate: null,
        budget: 0
      }
    };
    
    saveOverlay(savedOverlay);
  });
}

/**
 * Delete an overlay from the map and database
 */
export function deleteOverlay(id: string) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  // Remove from map
  if (overlayObject.overlay && map.value) {
    map.value.removeLayer(overlayObject.overlay);
  }
  
  // Remove marker
  if (overlayObject.marker && map.value) {
    map.value.removeLayer(overlayObject.marker);
  }
  
  // Remove from state
  delete overlays.value[id];

  // Remove from database using the imported function
  deleteOverlayFromDatabase(id);
}

/**
 * Update overlay information and metadata
 */
export function updateOverlayInfo(id: string, info: ProjectInfo) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  overlayObject.info = info;
  updateTooltipText();
  saveImageAndPosition();
}