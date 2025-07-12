// AI : Simplified database replacement - works directly with backend
import type { StoredOverlayData, StoredProjectData } from '@types';

export async function initializeDatabase(): Promise<void> {
  // AI : No IndexedDB needed - backend handles all persistence
  console.log('AI : Database initialization complete - using backend directly');
}

export async function clearDatabase(): Promise<void> {
  // AI : No local database to clear
  console.log('AI : No local database to clear - data persisted on backend');
}

// AI : Save overlay to local storage only - NO BACKEND CALLS
export async function saveOverlay(overlay: StoredOverlayData): Promise<void> {
  try {
    // AI : Just store locally in memory - no backend calls during editing
    // AI : This will be handled by a separate publish function when user explicitly saves
    console.log('AI : Overlay saved locally (no backend call):', overlay.id);
  } catch (error) {
    console.error('AI : Error saving overlay locally:', error);
  }
}

// AI : Delete project from backend
export async function deleteProject(_projectId: string): Promise<void> {
  try {
    // AI : Note: Backend doesn't have deleteProject endpoint, would need to be added
    console.warn('AI : Delete project not implemented in backend yet');
  } catch (error) {
    console.error('AI : Error deleting project from backend:', error);
  }
}

// AI : Get project from backend
export async function getProject(_projectId: string): Promise<StoredProjectData | undefined> {
  try {
    // AI : Note: Backend doesn't have getProject endpoint, would need to be added
    console.warn('AI : Get project not implemented in backend yet');
    return undefined;
  } catch (error) {
    console.error('AI : Error getting project from backend:', error);
    return undefined;
  }
}

// AI : Legacy city functions - cities are handled by backend
export async function saveCity(): Promise<void> {
  console.warn('AI : saveCity is deprecated - cities are handled by backend');
}

export async function getCity(): Promise<any> {
  console.warn('AI : getCity is deprecated - cities are handled by backend');
  return undefined;
}
