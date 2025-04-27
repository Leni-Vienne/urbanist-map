import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { ref, shallowRef, watch } from 'vue';
import { map, calculateScreenCoverage, debouncedUpdateMapSize } from './useMap';
import { getAllOverlays, saveOverlay } from './useDatabase';
import type { overlayObject, StoredOverlayData, info } from '../types';
import { editTools, viewTools, infoTool } from './useTools';
import { getImageUrlForCoverage } from './useImageResizer';

export const overlays = shallowRef<Record<string, overlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(true);

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

// Debounce updateImageResolutionsForCoverage function
const debouncedUpdateImageResolutions = (function() {
  let timeout: number | undefined;
  return function() {
    clearTimeout(timeout);
    timeout = setTimeout(updateImageResolutionsForCoverage, 250) as unknown as number;
  };
})();

export async function initializeOverlays() {
  const savedOverlays = await getAllOverlays();
  
  if (!map.value) return;
  
  const mapBounds = map.value.getBounds();
  
  // Créer tous les marqueurs d'abord, même pour les images qui ne seront pas chargées
  savedOverlays.forEach(async (savedOverlay) => {
    const overlayBounds = getOverlayBounds(savedOverlay);
    if (overlayBounds) {
      // Si marqueur n'existe pas déjà
      if (!allMarkers.value[savedOverlay.id] && map.value) {
        const center = overlayBounds.getCenter();
        const marker = L.marker(center, {
          title: savedOverlay.info?.projectName || 'Overlay'
        }).addTo(map.value);
        
        // Ajouter un événement de clic
        marker.on('click', () => {
          // Si l'overlay n'est pas chargé, le charger
          if (!overlays.value[savedOverlay.id]) {
            loadOverlayById(savedOverlay.id);
          }
          
          // Si l'overlay est chargé, le sélectionner
          if (overlays.value[savedOverlay.id] && overlays.value[savedOverlay.id].overlay) {
            overlays.value[savedOverlay.id].overlay!.fire('select');
          }
        });
        
        allMarkers.value[savedOverlay.id] = marker;
      }
    }
  });
  
  // Puis, charger uniquement les overlays qui prennent assez de place
  savedOverlays.forEach(async (savedOverlay) => {
    // Check if overlay is within current map bounds with enough coverage
    if (isOverlayWithinBounds(savedOverlay, mapBounds)) {
      const overlayObject = createOverlayObject(savedOverlay);
      
      // Create a bounds object from the overlay corners to calculate coverage
      const overlayBounds = getOverlayBounds(savedOverlay);
      if (overlayBounds) {
        console.log(`Overlay ${savedOverlay.id} - Bounds: ${overlayBounds.toBBoxString()}`);
        const coveragePercent = calculateScreenCoverage(overlayBounds);
        
        // Use the appropriate resolution based on screen coverage
        const imageUrl = savedOverlay.imageResolutions 
          ? getImageUrlForCoverage(savedOverlay.imageResolutions, coveragePercent)
          : savedOverlay.imageUrl;
        
        const newOverlay = await createOverlay(imageUrl, overlayObject);
        overlayObject.overlay = newOverlay!;
        
        // Associer le marqueur existant à l'overlay
        overlayObject.marker = allMarkers.value[savedOverlay.id];
        
        overlays.value[savedOverlay.id] = overlayObject;
      }
    }
  });
  
  // Add event listeners to load more overlays and update resolutions
  map.value.on('moveend', loadOverlaysInView);
  map.value.on('zoomend', debouncedUpdateImageResolutions);
  
  // Use the debounced function for resize event
  window.removeEventListener('resize', updateImageResolutionsForCoverage); // Remove any existing listener
  window.addEventListener('resize', debouncedUpdateImageResolutions);
}

// Helper function to create a bounds object from overlay corners
function getOverlayBounds(overlay: StoredOverlayData): L.LatLngBounds | null {
  // If no corners data or empty, return null
  if (!overlay.corners || overlay.corners.length < 2) {
    return null;
  }
  
  // Create a bounds object from the overlay corners
  return L.latLngBounds(
    overlay.corners.map(corner => L.latLng(corner.lat, corner.lng))
  );
}

// Helper function to check if an overlay is within the current map bounds
// We're removing the screen coverage threshold so overlays are always visible
function isOverlayWithinBounds(overlay: StoredOverlayData, bounds: L.LatLngBounds): boolean {
  // If no corners data or empty, consider it visible (likely a new overlay)
  if (!overlay.corners || overlay.corners.length === 0) {
    return true;
  }
  
  const overlayBounds = getOverlayBounds(overlay);
  if (!overlayBounds) return true;
  
  // Check if the overlay bounds intersect with the map bounds
  if (!bounds.intersects(overlayBounds)) {
    return false;
  }
  
  // Always return true if the overlay intersects with the map bounds
  // This ensures thumbnails are shown even when viewed from far away
  return true;
}

// Function to load overlays that come into view when panning/zooming
async function loadOverlaysInView() {
  if (!map.value) return;
  
  const currentBounds = map.value.getBounds();
  const savedOverlays = await getAllOverlays();
  
  // Find overlays that aren't loaded yet but are now in view
  savedOverlays.forEach(async (savedOverlay) => {
    const isAlreadyLoaded = overlays.value[savedOverlay.id] !== undefined;
    
    if (!isAlreadyLoaded && isOverlayWithinBounds(savedOverlay, currentBounds)) {
      const overlayObject = createOverlayObject(savedOverlay);
      
      // Calculate coverage to determine appropriate resolution
      const overlayBounds = getOverlayBounds(savedOverlay);
      if (overlayBounds) {
        const coveragePercent = calculateScreenCoverage(overlayBounds);
        
        // Use the appropriate resolution based on screen coverage
        const imageUrl = savedOverlay.imageResolutions 
          ? getImageUrlForCoverage(savedOverlay.imageResolutions, coveragePercent)
          : savedOverlay.imageUrl;
        
        const newOverlay = await createOverlay(imageUrl, overlayObject);
        overlayObject.overlay = newOverlay!;
        overlays.value[savedOverlay.id] = overlayObject;
      }
    }
  });
}

// Function to update overlay image resolutions based on screen coverage
function updateImageResolutionsForCoverage() {
  if (!map.value) return;
  
  const currentBounds = map.value.getBounds();
  
  Object.entries(overlays.value).forEach(([id, overlayObject]) => {
    if (overlayObject.overlay) {
      const bounds = overlayObject.overlay.getBounds();
      const coveragePercent = calculateScreenCoverage(bounds);
      
      console.log(`Overlay ${id} - Coverage: ${coveragePercent.toFixed(2)}%`);
      
      // On supprime le mécanisme de visibilité qui cachait les overlays sous un certain seuil
      // Les overlays resteront visibles quel que soit le niveau de zoom
      // Seule leur résolution sera ajustée en fonction du zoom
      
      // Choix de la résolution optimale en fonction du pourcentage de couverture
      if (overlayObject.imageResolutions) {
        // Get the optimal resolution for this coverage
        const bestResolutionUrl = getImageUrlForCoverage(overlayObject.imageResolutions, coveragePercent);
        
        // Si l'URL obtenue est vide, ne pas mettre à jour
        if (!bestResolutionUrl) {
          console.warn(`Overlay ${id} - Received empty URL for resolution, keeping current`);
          return;
        }
        
        // Tronquer les URLs pour l'affichage dans les logs
        const currentUrlForLog = overlayObject.currentResolution ? 
          (overlayObject.currentResolution.length > 30 ? 
           overlayObject.currentResolution.substring(0, 30) + '...' : 
           overlayObject.currentResolution) : 'none';
           
        const bestUrlForLog = bestResolutionUrl.length > 30 ? 
          bestResolutionUrl.substring(0, 30) + '...' : bestResolutionUrl;
        
        console.log(`Overlay ${id} - Current resolution: ${currentUrlForLog}`);
        console.log(`Overlay ${id} - Best resolution: ${bestUrlForLog}`);
        
        // Only update if the best resolution for current coverage is different from current
        if (bestResolutionUrl !== overlayObject.currentResolution) {
          console.log(`Overlay ${id} - Updating image resolution for coverage ${coveragePercent.toFixed(2)}%`);
          updateOverlayImage(overlayObject, bestResolutionUrl);
          overlayObject.currentResolution = bestResolutionUrl;
        }
      } else {
        console.warn(`Overlay ${id} - No imageResolutions available`);
      }
    }
  });
}

export function createOverlayObject(savedOverlay: StoredOverlayData): overlayObject {
    return {
    ...savedOverlay,
        overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
    currentResolution: savedOverlay.imageUrl,
  };
}

export async function createOverlay(imageUrl: string, overlayObject?: overlayObject) {
  if (!map.value || !overlayObject) return null;

  if (!overlayObject.imageUrl) {
    overlayObject.imageUrl = imageUrl;
  }
  const newOverlay = L.distortableImageOverlay(imageUrl, {
    editable: true,
    tooltipText: overlayObject.info?.projectName,
    keyboard: false,
    actions: [
      infoTool,
      ...editTools
    ],
  }).addTo(map.value);

  overlayObject.overlay = newOverlay;

  // Update border on selection
  newOverlay.on('select', () => {
    setOverlayBorder(newOverlay.getElement(), true);
    idSelectedOverlay.value = overlayObject.id;
  });

  newOverlay.on('deselect', () => {
    setOverlayBorder(newOverlay.getElement(), false);
    idSelectedOverlay.value = null;
  });

  // Explicitly disable keyboard handling on the overlay
  if (newOverlay.editing && newOverlay.editing._disableKeyboard) {
    newOverlay.editing._disableKeyboard();
  }

  const element = newOverlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return null;
  }

  L.DomEvent.on(element, 'load', () => {
    // Priorité 1: Utiliser les coins directement si disponibles
    if (overlayObject.corners && overlayObject.corners.length === 4) {
      (overlayObject.overlay as any).setCorners(overlayObject.corners);
    }
    // Priorité 2: Utiliser l'historique si disponible
    else if (overlayObject.alreadyStored || overlayObject.alreadyLoaded) {
      if (overlayObject.history && overlayObject.history.length > 0) {
        (overlayObject.overlay as any).setCorners(overlayObject.history.at(-1));
      }
    } 
    // Priorité 3: Créer un nouvel historique si c'est un nouvel overlay
    else {
      // Save initial state to history
      const initialState = (overlayObject.overlay as any).getCorners();
      overlayObject.history = [initialState];
      overlayObject.redoStack = [];
    }

    if (!overlayObject.alreadyLoaded) {
      const marker = createMarker(overlayObject);
      if (marker) {
        overlayObject.marker = marker;
      }
    }

    overlayObject.alreadyLoaded = true;
    overlayObject.alreadyStored = true;
  });

  // Add event listeners for transformations
  newOverlay.on('edit', () => {
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    
    // Sauvegarder également les coins actuels pour une persistance directe
    overlayObject.corners = newOverlay.getCorners();
  });

  newOverlay.on('dragend', () => {
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    
    // Sauvegarder également les coins actuels pour une persistance directe
    overlayObject.corners = newOverlay.getCorners();
  });

  return newOverlay;
}

export function createMarker(overlayObject: overlayObject) {
  if (!map.value || !overlayObject.overlay) return null;
  
  // Si un marqueur existe déjà pour cet overlay, utilisez-le
  if (allMarkers.value[overlayObject.id]) {
    overlayObject.marker = allMarkers.value[overlayObject.id];
    return overlayObject.marker;
  }
  
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  
  // Créer un marqueur cliquable qui affiche le nom du projet
  const marker = L.marker(center, {
    title: overlayObject.info?.projectName || 'Overlay'
  }).addTo(map.value);
  
  // Ajouter un événement de clic pour charger l'overlay s'il n'est pas déjà chargé
  marker.on('click', () => {
    // Si l'overlay n'est pas chargé, le charger
    if (!overlays.value[overlayObject.id]) {
      loadOverlayById(overlayObject.id);
    }
    
    // Si l'overlay est chargé, le sélectionner
    if (overlays.value[overlayObject.id] && overlays.value[overlayObject.id].overlay) {
      overlays.value[overlayObject.id].overlay!.fire('select');
    }
  });
  
  // Stocker le marqueur dans la collection globale
  allMarkers.value[overlayObject.id] = marker;
  
  return marker;
}

export function updateMarkerPosition(overlayObject: overlayObject) {
  if (!overlayObject.overlay || !overlayObject.marker) return;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

export const SELECTED_OVERLAY_OUTLINE = '8px solid #ffffff';
export const SELECTED_OVERLAY_OUTLINE_OFFSET = '-8px';

export function setOverlayBorder(element: HTMLImageElement | undefined, isSelected: boolean) {
  if (!element) return;
  if (isSelected) {
    element.style.outline = SELECTED_OVERLAY_OUTLINE;
    element.style.outlineOffset = SELECTED_OVERLAY_OUTLINE_OFFSET;
  } else {
    element.style.outline = '';
    element.style.outlineOffset = '';
  }
}

export function saveToHistory(overlayObject: overlayObject) {
  if (!overlayObject.overlay) return;
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = [];
  
  // Mettre à jour directement les coins dans l'objet
  overlayObject.corners = overlayObject.overlay.getCorners();
  
  // Créer un objet sans les propriétés non sérialisables (overlay et marker)
  // pour le sauvegarder dans la base de données
  const savedOverlay: StoredOverlayData = {
    id: overlayObject.id,
    imageUrl: overlayObject.imageUrl,
    imageResolutions: overlayObject.imageResolutions,
    corners: overlayObject.corners,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    info: overlayObject.info
  };
  
  // Sauvegarder dans la base de données
  saveOverlay(savedOverlay);
}

export function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  Object.values(overlays.value).forEach((overlayObject) => {
    const editing = (overlayObject.overlay as any).editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }

    const element = overlayObject.overlay?.getElement();
    if (element) {
      if (isEditMode.value) {
        element.style.boxShadow = SELECTED_OVERLAY_OUTLINE;
      } else {
        element.style.boxShadow = '';
      }
    }
  });
}

// Function to load a specific overlay by ID
export async function loadOverlayById(id: string) {
  if (!map.value) return;
  
  // Récupérer les données de l'overlay depuis la base de données
  const allOverlays = await getAllOverlays();
  const savedOverlay = allOverlays.find(overlay => overlay.id === id);
  
  if (!savedOverlay) {
    console.error(`Overlay avec ID ${id} non trouvé dans la base de données`);
    return;
  }
  
  // Créer l'objet overlay
  const overlayObject = createOverlayObject(savedOverlay);
  
  // S'assurer que les coins et l'historique sont correctement préservés
  overlayObject.corners = savedOverlay.corners;
  overlayObject.history = savedOverlay.history;
  
  // Calculer la couverture pour déterminer la résolution appropriée
  const overlayBounds = getOverlayBounds(savedOverlay);
  if (overlayBounds) {
    const coveragePercent = calculateScreenCoverage(overlayBounds);
    
    // Utiliser la résolution appropriée en fonction de la couverture d'écran
    const imageUrl = savedOverlay.imageResolutions 
      ? getImageUrlForCoverage(savedOverlay.imageResolutions, coveragePercent)
      : savedOverlay.imageUrl;
    
    const newOverlay = await createOverlay(imageUrl, overlayObject);
    overlayObject.overlay = newOverlay!;
    
    // Utiliser les dernières coordonnées enregistrées
    if (overlayObject.overlay && savedOverlay.corners && savedOverlay.corners.length > 0) {
      // Appliquer les coins enregistrés
      overlayObject.overlay.setCorners(savedOverlay.corners);
    }
    
    overlays.value[savedOverlay.id] = overlayObject;
    
    // Mettre à jour la position du marqueur existant
    if (allMarkers.value[id]) {
      updateMarkerPosition(overlayObject);
    }
  }
}

// New function to update an overlay's image without recreating the overlay
export function updateOverlayImage(overlayObject: overlayObject, newImageUrl: string) {
  if (!overlayObject.overlay) {
    console.error(`Cannot update image: overlay is null for ${overlayObject.id}`);
    return;
  }
  
  try {
    // Approche 1: Mise à jour directe de l'attribut src
    const imgElement = overlayObject.overlay.getElement();
    if (imgElement) {
      console.log(`Updating image element src from ${imgElement.src.substring(0, 30)}... to ${newImageUrl.substring(0, 30)}...`);
      
      // Ajouter un écouteur pour confirmer le chargement de la nouvelle image
      const onLoadListener = () => {
        console.log(`New image successfully loaded: ${newImageUrl.substring(0, 30)}...`);
        imgElement.removeEventListener('load', onLoadListener);
      };
      
      const onErrorListener = (error: any) => {
        console.error(`Error loading new image: ${newImageUrl.substring(0, 30)}...`, error);
        imgElement.removeEventListener('error', onErrorListener);
      };
      
      imgElement.addEventListener('load', onLoadListener);
      imgElement.addEventListener('error', onErrorListener);
      
      // Changer la source de l'image
      imgElement.src = newImageUrl;
      
      // Mettre à jour la résolution actuelle dans l'objet
      overlayObject.currentResolution = newImageUrl;
      return;
    } else {
      console.error(`Cannot update image: imgElement is null for ${overlayObject.id}`);
    }
    
    // Approche 2 (fallback): Si la méthode directe ne fonctionne pas, essayer avec setUrl si disponible
    if (typeof overlayObject.overlay.setUrl === 'function') {
      console.log(`Falling back to setUrl method for ${overlayObject.id}`);
      overlayObject.overlay.setUrl(newImageUrl);
      overlayObject.currentResolution = newImageUrl;
      return;
    }
    
    console.error(`Failed to update image for ${overlayObject.id}: no valid update method found`);
  } catch (error) {
    console.error(`Error updating image for ${overlayObject.id}:`, error);
  }
}