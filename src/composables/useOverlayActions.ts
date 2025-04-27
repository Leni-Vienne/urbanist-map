import { map, calculateScreenCoverage } from './useMap';
import { overlays, idSelectedOverlay, updateMarkerPosition, saveToHistory, createOverlay, updateOverlayImage } from './useOverlay';
import { saveOverlay, deleteOverlay as deleteOverlayFromDb } from './useDatabase';
import { generateImageResolutions, getImageUrlForCoverage } from './useImageResizer';
import type { info, ImageResolutions } from '../types';
import { useToast } from './useToast';

const toast = await useToast();

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

  // Default to original resolution for newly added images
  // (screen coverage will be calculated after overlay is created)
  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  overlays.value[id] = overlayObject;
  updateTooltipText();
  
  // Once the overlay is loaded and corners are set, update to appropriate resolution
  setTimeout(() => {
    if (overlayObject.overlay) {
      const bounds = overlayObject.overlay.getBounds();
      const coveragePercent = calculateScreenCoverage(bounds);
      const appropriateImageUrl = getImageUrlForCoverage(imageResolutions, coveragePercent);
      
      if (appropriateImageUrl !== imageUrl) {
        updateOverlayImage(overlayObject, appropriateImageUrl);
        overlayObject.currentResolution = appropriateImageUrl;
      }
    }
  }, 100);
}

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

export async function toggleWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  overlayObject.whitePixelsHidden = !overlayObject.whitePixelsHidden;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !map.value) return;

  const img = new Image();
  img.onload = async () => {
    if (!map.value || !overlayObject.overlay) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    if (overlayObject.whitePixelsHidden) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

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
    }

    // Au lieu de supprimer et recréer l'overlay, on met à jour l'image
    const imgElement = overlayObject.overlay.getElement();
    if (imgElement) {
      const newSrc = overlayObject.whitePixelsHidden ? 
        canvas.toDataURL() : 
        overlayObject.imageUrl;
        
      imgElement.src = newSrc;
    }

    toast.add({
      severity: 'info',
      summary: overlayObject.whitePixelsHidden ? 'Background pixels have been hidden' : 'Background pixels are now visible',
      life: 2000
    });
  };

  img.src = overlayObject.whitePixelsHidden ? 
    (overlayObject.imageUrl || (overlayObject.overlay as any).getElement().src) : 
    (overlayObject.overlay as any).getElement().src;
}

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

    const center = {
      lat: (currentCorners[0].lat + currentCorners[2].lat) / 2,
      lng: (currentCorners[0].lng + currentCorners[2].lng) / 2
    };

    const bounds = overlayObject.overlay.getBounds();
    const northEast = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const southWest = map.value.latLngToContainerPoint(bounds.getSouthWest());
    const currentWidthPx = Math.abs(northEast.x - southWest.x);
    const currentHeightPx = Math.abs(northEast.y - southWest.y);

    const originalRatio = img.naturalWidth / img.naturalHeight;

    let newWidth: number, newHeight: number;
    if (currentWidthPx / currentHeightPx > originalRatio) {
      newHeight = currentHeightPx;
      newWidth = newHeight * originalRatio;
    } else {
      newWidth = currentWidthPx;
      newHeight = newWidth / originalRatio;
    }

    const centerPoint = map.value.latLngToContainerPoint(center);
    const halfWidth = newWidth / 2;
    const halfHeight = newHeight / 2;

    const newCorners = [
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y - halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y - halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y + halfHeight]),
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y + halfHeight])
    ];

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

  img.src = overlayObject.imageUrl ||
    (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

export function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  const projectName = overlayObject.info?.projectName || 'No Project Name';
  overlayObject.overlay.bindTooltip(projectName, { permanent: true, direction: 'top' }).openTooltip();
}

export function saveImageAndPosition() {
  const savedOverlays = Object.values(overlays.value).map(overlayObj => {
    // S'assurer que nous utilisons les coordonnées les plus récentes
    if (overlayObj.overlay) {
      overlayObj.corners = overlayObj.overlay.getCorners();
    }
    
    return {
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
  });

  savedOverlays.forEach(overlay => {
    saveOverlay(overlay);
  });
}

export function deleteOverlay(id: string) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  if (overlayObject.overlay && map.value) {
    map.value.removeLayer(overlayObject.overlay);
  }
  if (overlayObject.marker && map.value) {
    map.value.removeLayer(overlayObject.marker);
  }
  delete overlays.value[id];

  deleteOverlayFromDb(id);
}

export function updateOverlayInfo(id: string, info: info) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  overlayObject.info = info;
  updateTooltipText();
  saveImageAndPosition();
}