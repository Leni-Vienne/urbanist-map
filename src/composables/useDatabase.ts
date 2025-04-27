import { openDB, IDBPDatabase } from 'idb';
import { MyDB, StoredOverlayData, MapPosition } from '../types';

let db: IDBPDatabase<MyDB> | null = null;

/**
 * Initialize the IndexedDB database
 */
export async function initializeDatabase(): Promise<void> {
  try {
    db = await openDB<MyDB>('CityMapOverlayDB', 1, {
      upgrade(upgradeDb) {
        if (!upgradeDb.objectStoreNames.contains('overlays')) {
          upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
        }
        if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
          upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
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
    console.log('Database cleared successfully');
  } catch (error) {
    console.error('Error clearing database:', error);
  }
}