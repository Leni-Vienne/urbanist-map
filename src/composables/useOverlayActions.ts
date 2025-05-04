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
    isFlipped: false, // AI : Add the missing isFlipped property
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

    // AI : Get current image state
    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners || currentCorners.length !== 4) return;
    
    // AI : Calculate the center and bounds
    const bounds = overlayObject.overlay.getBounds();
    const center = bounds.getCenter();
    
    // AI : Calculate current width and height in pixels
    const nw = map.value.latLngToContainerPoint(currentCorners[0]);
    const ne = map.value.latLngToContainerPoint(currentCorners[1]);
    const se = map.value.latLngToContainerPoint(currentCorners[3]);
    const sw = map.value.latLngToContainerPoint(currentCorners[2]);
    
    // AI : Calculate distances between corners
    const topEdge = nw.distanceTo(ne);
    const rightEdge = ne.distanceTo(se);
    const bottomEdge = sw.distanceTo(se);
    const leftEdge = nw.distanceTo(sw);
    
    // AI : Use average for more accuracy
    const currentWidth = (topEdge + bottomEdge) / 2;
    const currentHeight = (leftEdge + rightEdge) / 2;
    
    // AI : Get the original aspect ratio
    const originalRatio = img.naturalWidth / img.naturalHeight;
    
    // AI : Determine new dimensions that maintain original ratio
    // AI : Always scale down, never up
    let newWidth, newHeight;
    
    if (currentWidth / currentHeight > originalRatio) {
      // AI : Width is too large relative to height
      newHeight = currentHeight;
      newWidth = currentHeight * originalRatio;
    } else {
      // AI : Height is too large relative to width
      newWidth = currentWidth;
      newHeight = currentWidth / originalRatio;
    }
    
    // AI : Determine the current rotation by analyzing the corners
    // AI : First, get vectors for the top and right edges
    const topVector = {
      x: ne.x - nw.x,
      y: ne.y - nw.y
    };
    
    // AI : Calculate rotation from the top edge
    const angleRad = Math.atan2(topVector.y, topVector.x);
    
    // AI : Check for orientation consistency to prevent unintended flipping
    // AI : By ensuring we preserve the original 'winding' of the corners
    const isClockwise = (ne.x - nw.x) * (se.y - nw.y) - (ne.y - nw.y) * (se.x - nw.x) > 0;
    
    // AI : Create the new corners maintaining center and rotation
    const halfWidth = newWidth / 2;
    const halfHeight = newHeight / 2;
    
    // AI : Convert center to pixel coordinates
    const centerPoint = map.value.latLngToContainerPoint(center);
    
    // AI : Calculate the corner offsets based on rotation
    const dx = [
      -halfWidth * Math.cos(angleRad) - halfHeight * Math.sin(angleRad), // NW
      halfWidth * Math.cos(angleRad) - halfHeight * Math.sin(angleRad),  // NE
      -halfWidth * Math.cos(angleRad) + halfHeight * Math.sin(angleRad), // SW
      halfWidth * Math.cos(angleRad) + halfHeight * Math.sin(angleRad)   // SE
    ];
    
    const dy = [
      -halfWidth * Math.sin(angleRad) + halfHeight * Math.cos(angleRad), // NW
      halfWidth * Math.sin(angleRad) + halfHeight * Math.cos(angleRad),  // NE
      -halfWidth * Math.sin(angleRad) - halfHeight * Math.cos(angleRad), // SW
      halfWidth * Math.sin(angleRad) - halfHeight * Math.cos(angleRad)   // SE
    ];
    
    // AI : Create new corners in pixel coordinates
    const newCornerPoints = [0, 1, 2, 3].map(i => {
      return {
        x: centerPoint.x + dx[i],
        y: centerPoint.y + dy[i]
      };
    });
    
    // AI : Check if we need to reverse the order to maintain original orientation
    const newIsClockwise = (newCornerPoints[1].x - newCornerPoints[0].x) * 
                          (newCornerPoints[3].y - newCornerPoints[0].y) - 
                          (newCornerPoints[1].y - newCornerPoints[0].y) * 
                          (newCornerPoints[3].x - newCornerPoints[0].x) > 0;
    
    if (isClockwise !== newIsClockwise) {
      // AI : Flip the order to maintain original orientation
      newCornerPoints.reverse();
    }
    
    // AI : Convert back to geographical coordinates
    const newCorners = newCornerPoints.map(point => 
      map.value!.containerPointToLatLng([point.x, point.y])
    );
    
    // AI : Apply ratio-corrected corners
    overlayObject.overlay.setCorners(newCorners);
    
    // AI : If this is the second click, also mirror the image horizontally
    if (overlayObject.isFlipped) {
      overlayObject.isFlipped = false;
      
      // AI : Get the new corners after ratio correction
      const currentRatioFixedCorners = overlayObject.overlay.getCorners();
      
      // AI : Swap NW with NE, and SW with SE corners for horizontal mirroring
      // AI : The corners array is in order: NW, NE, SW, SE
      const mirroredCorners = [
        currentRatioFixedCorners[1], // NE becomes NW
        currentRatioFixedCorners[0], // NW becomes NE
        currentRatioFixedCorners[3], // SE becomes SW
        currentRatioFixedCorners[2]  // SW becomes SE
      ];
      
      // AI : Apply the mirrored corners
      overlayObject.overlay.setCorners(mirroredCorners);
      
      toast.add({
        severity: 'success',
        summary: 'Image ratio reset and mirrored',
        detail: 'Image has been reset to original ratio and mirrored horizontally',
        life: 5000
      });
    } else {
      overlayObject.isFlipped = true;
      
      toast.add({
        severity: 'success',
        summary: 'Image ratio reset',
        detail: 'Click again to mirror the image horizontally',
        life: 5000
      });
    }
    
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    saveImageAndPosition();
  };

  img.src = overlayObject.imageUrl || (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

/**
 * AI : Navigates between overlays in the current project.
 * @param direction - The direction to navigate ('next' or 'previous')
 * Uses the order in the project's overlayIds array.
 * Automatically selects the overlay to open its toolbar.
 */
export function navigateOverlay(direction: 'next' | 'previous') {
  if (!map.value) {
    toast.add({
      severity: 'warn',
      summary: 'Map not available',
      detail: 'Cannot navigate between overlays',
      life: 3000
    });
    return;
  }
  
  // AI : If no overlay is selected, try to select the first/last overlay in any project
  if (!idSelectedOverlay.value) {
    const projectIds = Object.keys(projects.value);
    if (projectIds.length === 0) {
      toast.add({
        severity: 'warn',
        summary: 'No projects',
        detail: 'Please create a project first',
        life: 3000
      });
      return;
    }
    
    for (const projectId of projectIds) {
      const project = projects.value[projectId];
      if (project.overlayIds.length > 0) {
        // AI : Select first overlay for 'next', last overlay for 'previous'
        const index = direction === 'next' ? 0 : project.overlayIds.length - 1;
        idSelectedOverlay.value = project.overlayIds[index];
        const overlay = overlays.value[idSelectedOverlay.value];
        if (overlay && overlay.overlay) {
          // AI : Click on the overlay to properly select it and open the toolbar
          const element = overlay.overlay.getElement();
          if (element) {
            element.click();
          }
          
          const bounds = overlay.overlay.getBounds();
          map.value.fitBounds(bounds, { padding: [50, 50] });
          
          toast.add({
            severity: 'info',
            summary: 'Navigation',
            detail: `Selected ${direction === 'next' ? 'first' : 'last'} overlay in project ${project.name}`,
            life: 3000
          });
        }
        return;
      }
    }
    
    toast.add({
      severity: 'warn',
      summary: 'No overlays',
      detail: 'No overlays found in any project',
      life: 3000
    });
    return;
  }

  const currentOverlay = overlays.value[idSelectedOverlay.value];
  if (!currentOverlay || !currentOverlay.projectId) return;
  
  const projectId = currentOverlay.projectId;
  const project = projects.value[projectId];
  if (!project || !project.overlayIds.length) return;
  
  // AI : Use the project's overlayIds directly without sorting
  const projectOverlayIds = project.overlayIds;
  
  if (projectOverlayIds.length <= 1) {
    toast.add({
      severity: 'info',
      summary: 'Navigation',
      detail: 'No other overlays in this project',
      life: 3000
    });
    return;
  }
  
  // AI : Find the current overlay's index
  const currentIndex = projectOverlayIds.indexOf(idSelectedOverlay.value);
  
  // AI : Get the next/previous overlay (with wraparound)
  const step = direction === 'next' ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];
  const newOverlay = overlays.value[newOverlayId];
  
  if (!newOverlay) return;
  
  // AI : Select and center the map on the new overlay
  idSelectedOverlay.value = newOverlayId;
  
  if (newOverlay.overlay) {
    // AI : Click on the overlay to properly select it and open the toolbar
    const element = newOverlay.overlay?.getElement();
    if (element) {
      element.click();
    }
    
    const bounds = newOverlay.overlay.getBounds();
    map.value.fitBounds(bounds, { padding: [50, 50] });
    
    toast.add({
      severity: 'info',
      summary: 'Navigation',
      detail: `Moved to overlay ${newIndex + 1} of ${projectOverlayIds.length}${newOverlay.phase ? ` (${newOverlay.phase})` : ''}`,
      life: 3000
    });
  } else if (newOverlay.marker) {
    map.value.setView(newOverlay.marker.getLatLng(), map.value.getZoom());
  }
}

/**
 * AI : Centers the map view on the next overlay in the current project.
 * Wrapper for navigateOverlay('next')
 */
export function goToNextOverlay() {
  navigateOverlay('next');
}

/**
 * AI : Centers the map view on the previous overlay in the current project.
 * Wrapper for navigateOverlay('previous')
 */
export function goToPreviousOverlay() {
  navigateOverlay('previous');
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