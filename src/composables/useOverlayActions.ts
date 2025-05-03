import L from "leaflet";
import { map, calculateScreenCoverage, onMapInitialized } from './useMap';
import { overlays, idSelectedOverlay, updateMarkerPosition, saveToHistory, createOverlay, updateOverlayImage } from './useOverlay';
import { saveOverlay, deleteOverlay as deleteOverlayFromDatabase, saveProject } from './useDatabase';
import { generateImageResolutions, getImageUrlForCoverage } from './useImageResizer';
import { useToast } from './useToast';
import { addOverlayToProjectWithId, projects } from './useProjects';

const toast = useToast();

export async function addOverlay(imageUrl: string, projectId: string) {
  if (!map.value) return;
  if (!projectId) {
    toast.add({
      severity: 'error',
      summary: 'Project Required',
      detail: 'A project must be selected to add an overlay',
      life: 3000
    });
    return;
  }

  const id = crypto.randomUUID();
  
  const imageResolutions = await generateImageResolutions(imageUrl);
  
  const overlayObject = {
    id,
    imageUrl,
    imageResolutions,
    overlay: null,
    marker: null as L.Marker | null,
    history: [],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: false,
    corners: [],
    projectId,
    phase: undefined as string | undefined,
    sequenceNumber: undefined as number | undefined,
    whitePixelsHidden: false,
    currentResolution: imageUrl,
  };

  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  if (newOverlay && map.value) {
    const imgElement = newOverlay.getElement();
    if (imgElement) {
      const onLoadHandler = () => {
        if (map.value && newOverlay) {
          try {
            const bounds = newOverlay.getBounds();
            if (bounds) {
              const center = bounds.getCenter();
              const marker = L.marker(center, {
                title: 'Overlay'
              }).addTo(map.value);
              
              overlayObject.marker = marker;
              
              if (projectId && projects.value[projectId]) {
                const project = projects.value[projectId];
                const tooltipText = `${project.name}${overlayObject.phase ? ` - ${overlayObject.phase}` : ''}`;
                marker.bindTooltip(tooltipText, { permanent: false }).openTooltip();
              }
            }
          } catch (error) {
            console.error('Error creating marker:', error);
          }
        }
        
        imgElement.removeEventListener('load', onLoadHandler);
      };
      
      imgElement.addEventListener('load', onLoadHandler);
      
      if (imgElement.complete && imgElement.naturalWidth > 0) {
        onLoadHandler();
      }
    }
  }

  overlays.value[id] = overlayObject;
  
  setTimeout(updateOverlayToAppropriateResolution(overlayObject), 100);
  
  addOverlayToProjectWithId(projectId, id);
}

function updateOverlayToAppropriateResolution(overlayObject) {
  return () => {
    if (!overlayObject.overlay || !overlayObject.imageResolutions) return;
    
    const updateResolution = () => {
      if (!map.value) return;
      
      const currentMapBounds = map.value.getBounds();
      const overlayBounds = overlayObject.overlay.getBounds();
      
      if (!currentMapBounds.intersects(overlayBounds)) {
        return;
      }
      
      const coveragePercent = calculateScreenCoverage(overlayBounds);
      
      const appropriateImageUrl = getImageUrlForCoverage(overlayObject.imageResolutions, coveragePercent);
      
      if (appropriateImageUrl && appropriateImageUrl !== overlayObject.currentResolution) {
        updateOverlayImage(overlayObject, appropriateImageUrl);
        overlayObject.currentResolution = appropriateImageUrl;
      }
    };
    
    updateResolution();
    onMapInitialized(updateResolution);
  };
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

  const currentState = history.pop()!;
  redoStack.push(currentState);

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

  const nextState = redoStack.pop()!;
  history.push(nextState);

  (overlay as any).setCorners(nextState);

  updateMarkerPosition(overlayObject);
  saveImageAndPosition();
}

export async function toggleWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  overlayObject.whitePixelsHidden = !overlayObject.whitePixelsHidden;
  
  try {
    const imgElement = overlayObject.overlay.getElement();
    if (!imgElement) return;
    
    const imgSrc = overlayObject.whitePixelsHidden ? 
      (overlayObject.imageUrl || imgElement.src) : 
      imgElement.src;
    
    if (overlayObject.whitePixelsHidden) {
      const processedImage = await processImageToHideWhitePixels(imgSrc);
      if (processedImage) {
        imgElement.src = processedImage;
      }
    } else {
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

    // AI : Calculate current dimensions in pixels
    const bounds = overlayObject.overlay.getBounds();
    const northEast = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const southWest = map.value.latLngToContainerPoint(bounds.getSouthWest());
    const currentWidthPx = Math.abs(northEast.x - southWest.x);
    const currentHeightPx = Math.abs(northEast.y - southWest.y);

    // AI : Calculate new dimensions maintaining the original aspect ratio
    const originalRatio = img.naturalWidth / img.naturalHeight;
    let newWidth, newHeight;
    
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

  img.src = overlayObject.imageUrl || (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

export function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  if (overlayObject.projectId) {
    const project = projects.value[overlayObject.projectId];
    if (project) {
      const tooltipText = `${project.name}${overlayObject.phase ? ` - ${overlayObject.phase}` : ''}`;
      overlayObject.overlay!.bindTooltip(tooltipText, { permanent: true, direction: 'top' }).openTooltip();
    }
  } else {
    overlayObject.overlay.bindTooltip('Overlay', { permanent: true, direction: 'top' }).openTooltip();
  }
}

export function saveImageAndPosition() {
  Object.values(overlays.value).forEach(overlayObj => {
    if (overlayObj.overlay) {
      overlayObj.corners = overlayObj.overlay.getCorners();
    }
    
    const savedOverlay = {
      id: overlayObj.id,
      imageUrl: overlayObj.imageUrl,
      imageResolutions: overlayObj.imageResolutions,
      corners: overlayObj.corners,
      history: overlayObj.history,
      redoStack: overlayObj.redoStack,
      projectId: overlayObj.projectId,
      phase: overlayObj.phase,
      sequenceNumber: overlayObj.sequenceNumber
    };
    
    saveOverlay(savedOverlay);
  });
}

export function deleteOverlay(id: string) {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  if (overlayObject.projectId && projects.value[overlayObject.projectId]) {
    const project = projects.value[overlayObject.projectId];
    project.overlayIds = project.overlayIds.filter(overlayId => overlayId !== id);
    saveProject(project);
  }

  if (overlayObject.overlay && map.value) {
    map.value.removeLayer(overlayObject.overlay);
  }
  
  if (overlayObject.marker && map.value) {
    map.value.removeLayer(overlayObject.marker);
  }
  
  delete overlays.value[id];

  deleteOverlayFromDatabase(id);
}

export function updateOverlayInfo(id: string, info: { phase?: string, sequenceNumber?: number }): void {
  const overlayObject = overlays.value[id];
  if (!overlayObject) return;

  overlayObject.phase = info.phase;
  overlayObject.sequenceNumber = info.sequenceNumber;
  
  updateTooltipText();
  saveImageAndPosition();
}