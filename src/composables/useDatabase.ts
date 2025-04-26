import { openDB, IDBPDatabase } from 'idb';
import { MyDB, StoredOverlayData, mapPosition } from '../types';

let db: IDBPDatabase<MyDB> | null = null;

export async function initializeDatabase() {
  db = await openDB('CityMapOverlayDB', 1, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains('overlays')) {
        upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
        upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
      }
    },
  });
}

export async function getSavedMapPosition() {
  if (!db) return null;
  const savedPosition = await db.get('mapPosition', 'position');
  return savedPosition ? savedPosition.value : null;
}

export async function saveMapPosition(position: mapPosition) {
  if (!db) return;
  const transaction = db.transaction('mapPosition', 'readwrite');
  const store = transaction.objectStore('mapPosition');
  await store.put(position);
}

export async function saveOverlay(overlay: StoredOverlayData) {
  if (!db) return;
  const transaction = db.transaction('overlays', 'readwrite');
  const store = transaction.objectStore('overlays');
  await store.put(overlay);
}

export async function getAllOverlays() {
  if (!db) return [];
  const transaction = db.transaction('overlays', 'readonly');
  const store = transaction.objectStore('overlays');
  return await store.getAll();
}

export async function deleteOverlay(id: string) {
  if (!db) return;
  const transaction = db.transaction('overlays', 'readwrite');
  const store = transaction.objectStore('overlays');
  await store.delete(id);
}

export function clearDatabase() {
  if (!db) return;

  const transactionOverlays = db.transaction('overlays', 'readwrite');
  const storeOverlays = transactionOverlays.objectStore('overlays');
  storeOverlays.clear();

  const transactionMapPosition = db.transaction('mapPosition', 'readwrite');
  const storeMapPosition = transactionMapPosition.objectStore('mapPosition');
  storeMapPosition.clear();
}