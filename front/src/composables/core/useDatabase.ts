import { openDB, IDBPDatabase } from 'idb';
import { projects } from '@stores/projectStore';
import { MyDB, StoredOverlayData, MapPosition, Project } from '@types';

let db: IDBPDatabase<MyDB> | null = null;

/**
 * Initialize the IndexedDB database
 */
export async function initializeDatabase(): Promise<void> {
  try {
    db = await openDB<MyDB>('CityMapOverlayDB', 2, {
      upgrade(upgradeDb, oldVersion) {
        // AI : Create stores if they don't exist
        if (!upgradeDb.objectStoreNames.contains('overlays')) {
          upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
        }
        if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
          upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
        }
        
        // AI : Create projects store in version 2
        if (oldVersion < 2 && !upgradeDb.objectStoreNames.contains('projects')) {
          upgradeDb.createObjectStore('projects', { keyPath: 'id' });
        }
      },
    });
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
    const overlays = await db.getAll('overlays');
    return overlays;
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
    // AI : Also clear projects store if it exists
    try {
      await db.clear('projects');
    } catch (error) {
      console.warn('Could not clear projects store, it may not exist yet:', error);
    }
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
    // AI : Create a plain object copy to avoid DataCloneError with reactive data
    const plainProject = {
      id: project.id,
      name: project.name,
      description: project.description,
      location: project.location,
      cityId: project.cityId, // AI : Include cityId for foreign key relationship
      city: project.city, // AI : Include city information from backend joins
      startDate: project.startDate,
      endDate: project.endDate,
      sourceUrl: project.sourceUrl,
      overlayIds: Array.isArray(project.overlayIds) ? [...project.overlayIds] : [], // AI : Ensure array copy
      color: project.color,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      savedRemotely: project.savedRemotely
    };
    await db.put('projects', plainProject);
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
    const result = await db.getAll('projects');
    // AI : Convert to Project type if necessary
    return result;
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
    let project = await db.get('projects', projectId);
      // AI : If project not found in IndexedDB, check if it exists in memory and save it
    if (!project) {
      console.warn(`AI : Project ${projectId} not found in IndexedDB, checking memory store...`);
      
      // AI : Check projects from centralized store
      const memoryProject = projects.value[projectId];
      
      if (memoryProject) {
        // AI : Create a plain object copy to avoid DataCloneError with reactive data
        const plainProject = {
          id: memoryProject.id,
          name: memoryProject.name,
          description: memoryProject.description,
          location: memoryProject.location,
          cityId: memoryProject.cityId, // AI : Include cityId for foreign key relationship
          city: memoryProject.city, // AI : Include city information from backend joins
          startDate: memoryProject.startDate,
          endDate: memoryProject.endDate,
          sourceUrl: memoryProject.sourceUrl,
          overlayIds: [...memoryProject.overlayIds], // AI : Create a new array copy
          color: memoryProject.color,
          createdAt: memoryProject.createdAt,
          updatedAt: memoryProject.updatedAt,
          savedRemotely: memoryProject.savedRemotely
        };
        // AI : Save the plain project object to IndexedDB
        await db.put('projects', plainProject);
        project = plainProject;
      } else {
        console.error('AI : Project not found in memory store either:', projectId);
        console.error('AI : Available projects in memory:', Object.keys(projects.value));
        return;
      }
    }
    
    // AI : Add overlay to project if not already included
    if (!project.overlayIds.includes(overlayId)) {
      project.overlayIds.push(overlayId);
      await db.put('projects', project);
    }
    
    // AI : Update overlay with project reference
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
    
    // AI : Remove overlay from project
    project.overlayIds = project.overlayIds.filter(id => id !== overlayId);
    await db.put('projects', project);
    
    // AI : Remove project reference from overlay
    const overlay = await db.get('overlays', overlayId);
    if (overlay && overlay.projectId === projectId) {
      overlay.projectId = ''; // AI : Use empty string instead of undefined
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