// AI : Simplified overlay composable that works directly with backend
import { ref, computed } from 'vue';
import { trpc } from '@client';
import { overlays } from '@stores/overlayStore';
import { selectedProjectId } from '@stores/projectStore';
import { useToast } from '@composables/ui/useToast';
import type { OverlayObject, CDNOverlayData } from '@types';
import L from 'leaflet';

const toast = useToast();

// AI : Map reference - will be set externally
export const map = ref<L.Map | null>(null);

// AI : Edit mode reference - imported from the edit mode composable when needed
export const isEditMode = ref<boolean>(false);

// AI : All markers for view mode
export const allMarkers = ref<Record<string, L.Marker>>({});

/**
 * AI : Upload and create a new overlay
 */
export async function uploadOverlay(
  file: File,
  projectId: string,
  caption?: string
): Promise<OverlayObject | null> {
  try {
    // AI : Upload file to backend
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch('/api/upload-image', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload image');
    }
    
    const { filename } = await response.json();
    
    // AI : Create overlay object
    const overlayId = crypto.randomUUID();
    const imageUrl = `${import.meta.env.VITE_CDN_URL}/${filename}`;
    
    const overlay: OverlayObject = {
      id: overlayId,
      filename,
      caption: caption || '',
      projectId,
      imageUrl,
      status: 'pending',
      authorId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      
      // AI : Default position (will be set when placed on map)
      topLeftLat: 0,
      topLeftLng: 0,
      topRightLat: 0,
      topRightLng: 0,
      bottomRightLat: 0,
      bottomRightLng: 0,
      bottomLeftLat: 0,
      bottomLeftLng: 0,
      centroid: { x: 0, y: 0 },
      corners: [],
      
      // AI : Runtime properties
      overlay: null,
      marker: null,
      alreadyLoaded: false,
      alreadyStored: false,
      whitePixelsHidden: false,
      isFlipped: false,
      history: [],
      redoStack: [],
      project: null
    };
    
    // AI : Add to active overlays
    overlays.value[overlayId] = overlay;
    
    return overlay;
    
  } catch (error) {
    console.error('AI : Error uploading overlay:', error);
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to upload overlay' });
    return null;
  }
}

/**
 * AI : Publish overlay to backend (explicit user action only)
 */
export async function publishOverlay(overlay: OverlayObject): Promise<boolean> {
  try {
    if (!overlay.overlay) {
      throw new Error('Overlay not loaded');
    }
    
    const corners = overlay.overlay.getCorners();
    
    await trpc.overlay.publishOverlay.mutate({
      id: overlay.id,
      filename: overlay.filename,
      caption: overlay.caption || undefined,
      projectId: overlay.projectId!,
      metadata: overlay.metadata,
      corners: corners.map(corner => ({
        lat: corner.lat,
        lng: corner.lng
      }))
    });
    
    toast.add({ severity: 'success', summary: 'Success', detail: 'Overlay published successfully' });
    return true;
    
  } catch (error) {
    console.error('AI : Error publishing overlay:', error);
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to publish overlay' });
    return false;
  }
}

/**
 * AI : Initialize overlays based on current mode
 */
export async function initializeOverlays(): Promise<void> {
  if (!map.value) return;
  
  // AI : Clear existing overlays
  Object.values(overlays.value).forEach(overlay => {
    if (overlay.overlay) {
      map.value!.removeLayer(overlay.overlay);
    }
    if (overlay.marker) {
      map.value!.removeLayer(overlay.marker);
    }
  });
  
  overlays.value = {};
  allMarkers.value = {};
}

/**
 * AI : Get overlays for current project
 */
export const projectOverlays = computed(() => {
  if (!selectedProjectId.value) return [];
  
  return Object.values(overlays.value).filter(
    overlay => overlay.projectId === selectedProjectId.value
  );
});

/**
 * AI : Remove overlay
 */
export function removeOverlay(overlayId: string): void {
  const overlay = overlays.value[overlayId];
  if (!overlay) return;
  
  // AI : Remove from map
  if (overlay.overlay && map.value) {
    map.value.removeLayer(overlay.overlay);
  }
  if (overlay.marker && map.value) {
    map.value.removeLayer(overlay.marker);
  }
  
  // AI : Remove from memory
  delete overlays.value[overlayId];
  delete allMarkers.value[overlayId];
}
