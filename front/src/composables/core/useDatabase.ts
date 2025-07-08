import { openDB, IDBPDatabase } from 'idb';
import {
  MyDB, StoredOverlayData, MapPosition, StoredProjectData, Project,
} from '@types';
import { DBCity } from '../../../../back/src/db/schema';

let db: IDBPDatabase<MyDB> | null = null;

/**
 * AI : Initialize the IndexedDB database
 */
export async function initializeDatabase(): Promise<void> {
  try {
    db = await openDB<MyDB>('CityMapOverlayDB', 3, {
      upgrade(upgradeDb, oldVersion) {
        // AI : Create stores if they don't exist
        if (!upgradeDb.objectStoreNames.contains('overlays')) {
          upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
        }
        if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
          upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
        }
        if (!upgradeDb.objectStoreNames.contains('projects')) {
          upgradeDb.createObjectStore('projects', { keyPath: 'id' });
        }
        // AI : Create cities store in version 3
        if (oldVersion < 3 && !upgradeDb.objectStoreNames.contains('cities')) {
          upgradeDb.createObjectStore('cities', { keyPath: 'id' });
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
 * AI : Save a project to the database
 */
export async function saveProject(project: StoredProjectData): Promise<void> {
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
 * AI : Get a project by ID
 */
export async function getProject(id: string): Promise<StoredProjectData | undefined> {
  if (!db) {
    console.warn('Database not initialized when getting project');
    return undefined;
  }
  try {
    const storedProject = await db.get('projects', id);
    return storedProject;
  } catch (error) {
    console.error('Error retrieving project:', error);
    return undefined;
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
 * AI : Save a city to the database
 */
export async function saveCity(city: DBCity): Promise<void> {
  if (!db) {
    console.warn('Database not initialized when saving city');
    return;
  }
  try {
    await db.put('cities', city);
  } catch (error) {
    console.error('Error saving city:', error);
  }
}

/**
 * AI : Get a city by ID
 */
export async function getCity(id: string): Promise<DBCity | undefined> {
  if (!db) {
    console.warn('Database not initialized when getting city');
    return undefined;
  }
  try {
    return await db.get('cities', id);
  } catch (error) {
    console.error('Error retrieving city:', error);
    return undefined;
  }
}

// AI : Note: The functions addOverlayToProject, removeOverlayFromProject, and getProjectOverlays
// AI : are removed as they are now managed at the application level, not in the database service.
// AI : The database service should only be responsible for direct data access, not business logic.
// AI : Helper functions for serialization are also removed as they are no longer needed with the new types.
