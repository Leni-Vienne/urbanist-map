import { openDB, IDBPDatabase } from 'idb';
import { MyDB, StoredOverlayData, MapPosition, Project } from '../types';

let db: IDBPDatabase<MyDB> | null = null;

/**
 * Initialize the IndexedDB database
 */
export async function initializeDatabase(): Promise<void> {
  try {
    db = await openDB<MyDB>('CityMapOverlayDB', 2, {
      upgrade(upgradeDb, oldVersion, newVersion) {
        // Create stores if they don't exist
        if (!upgradeDb.objectStoreNames.contains('overlays')) {
          upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
        }
        if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
          upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
        }
        
        // Create projects store in version 2
        if (oldVersion < 2 && !upgradeDb.objectStoreNames.contains('projects')) {
          console.log('Creating projects object store');
          upgradeDb.createObjectStore('projects', { keyPath: 'id' });
        }
      },
    });
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw new Error('Database initialization failed');
  }
}

/**
 * Get the saved map position from the database
 */
export async function getSavedMapPosition() {
  if (!db) {
    console.warn('Database not initialized when getting map position');
    return null;
  }
  
  try {
    const savedPosition = await db.get('mapPosition', 'position');
    return savedPosition ? savedPosition.value : null;
  } catch (error) {
    console.error('Error retrieving map position:', error);
    return null;
  }
}

/**
 * Save the current map position to the database
 */
export async function saveMapPosition(position: MapPosition): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when saving map position');
    return;
  }
  
  try {
    await db.put('mapPosition', position);
  } catch (error) {
    console.error('Error saving map position:', error);
  }
}

/**
 * Save an overlay to the database
 */
export async function saveOverlay(overlay: StoredOverlayData): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when saving overlay');
    return;
  }
  
  try {
    await db.put('overlays', overlay);
  } catch (error) {
    console.error('Error saving overlay:', error);
  }
}

/**
 * Get all overlays from the database
 */
export async function getAllOverlays(): Promise<StoredOverlayData[]> {
  if (!db) {
    console.warn('Database not initialized when getting all overlays');
    return [];
  }
  
  try {
    return await db.getAll('overlays');
  } catch (error) {
    console.error('Error retrieving all overlays:', error);
    return [];
  }
}

/**
 * Delete an overlay from the database
 */
export async function deleteOverlay(id: string): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when deleting overlay');
    return;
  }
  
  try {
    await db.delete('overlays', id);
  } catch (error) {
    console.error('Error deleting overlay:', error);
  }
}

/**
 * Clear all data from the database
 */
export async function clearDatabase(): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when clearing database');
    return;
  }
  
  try {
    await db.clear('overlays');
    await db.clear('mapPosition');
    // Also clear projects store if it exists
    try {
      await db.clear('projects');
    } catch (error) {
      console.warn('Could not clear projects store, it may not exist yet:', error);
    }
    console.log('Database cleared successfully');
  } catch (error) {
    console.error('Error clearing database:', error);
  }
}

/**
 * Save a project to the database
 */
export async function saveProject(project: Project): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when saving project');
    return;
  }
  
  try {
    await db.put('projects', project);
  } catch (error) {
    console.error('Error saving project:', error);
  }
}

/**
 * Get a project by ID
 */
export async function getProject(id: string): Promise<Project | undefined> {
  if (!db) {
    console.warn('Database not initialized when getting project');
    return undefined;
  }
  
  try {
    return await db.get('projects', id);
  } catch (error) {
    console.error('Error retrieving project:', error);
    return undefined;
  }
}

/**
 * Get all projects from the database
 */
export async function getAllProjects(): Promise<Project[]> {
  if (!db) {
    console.warn('Database not initialized when getting all projects');
    return [];
  }
  
  try {
    return await db.getAll('projects');
  } catch (error) {
    console.error('Error retrieving all projects:', error);
    return [];
  }
}

/**
 * Delete a project from the database
 */
export async function deleteProject(id: string): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when deleting project');
    return;
  }
  
  try {
    await db.delete('projects', id);
  } catch (error) {
    console.error('Error deleting project:', error);
  }
}

/**
 * Add an overlay to a project
 */
export async function addOverlayToProject(projectId: string, overlayId: string): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when adding overlay to project');
    return;
  }
  
  try {
    const project = await db.get('projects', projectId);
    if (!project) {
      console.error('Project not found:', projectId);
      return;
    }
    
    // Add overlay to project if not already included
    if (!project.overlayIds.includes(overlayId)) {
      project.overlayIds.push(overlayId);
      await db.put('projects', project);
    }
    
    // Update overlay with project reference
    const overlay = await db.get('overlays', overlayId);
    if (overlay) {
      overlay.projectId = projectId;
      await db.put('overlays', overlay);
    }
  } catch (error) {
    console.error('Error adding overlay to project:', error);
  }
}

/**
 * Remove an overlay from a project
 */
export async function removeOverlayFromProject(projectId: string, overlayId: string): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when removing overlay from project');
    return;
  }
  
  try {
    const project = await db.get('projects', projectId);
    if (!project) {
      console.error('Project not found:', projectId);
      return;
    }
    
    // Remove overlay from project
    project.overlayIds = project.overlayIds.filter(id => id !== overlayId);
    await db.put('projects', project);
    
    // Remove project reference from overlay
    const overlay = await db.get('overlays', overlayId);
    if (overlay && overlay.projectId === projectId) {
      overlay.projectId = undefined;
      await db.put('overlays', overlay);
    }
  } catch (error) {
    console.error('Error removing overlay from project:', error);
  }
}

/**
 * Get all overlays for a project
 */
export async function getProjectOverlays(projectId: string): Promise<StoredOverlayData[]> {
  if (!db) {
    console.warn('Database not initialized when getting project overlays');
    return [];
  }
  
  try {
    const project = await db.get('projects', projectId);
    if (!project) {
      console.error('Project not found:', projectId);
      return [];
    }
    
    const overlays: StoredOverlayData[] = [];
    for (const overlayId of project.overlayIds) {
      const overlay = await db.get('overlays', overlayId);
      if (overlay) {
        overlays.push(overlay);
      }
    }
    
    return overlays;
  } catch (error) {
    console.error('Error getting project overlays:', error);
    return [];
  }
}