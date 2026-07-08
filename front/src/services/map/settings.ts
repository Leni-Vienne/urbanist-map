import { ref } from "vue";

// Persisted map display settings. Module-level singleton refs so components (menus, controls)
// and map services can read or watch the same state; toggles write through to localStorage.

const BUILDINGS_3D_KEY = "show-3d-buildings";
const ROTATION_KEY = "map-rotation-enabled";

// Both settings default to enabled, matching the map's out-of-the-box behavior.
function loadSetting(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== "false";
  } catch {
    return true;
  }
}

function saveSetting(storageKey: string, value: boolean): void {
  try {
    localStorage.setItem(storageKey, String(value));
  } catch {
    // localStorage may be unavailable (private mode); preference stays in-memory only
  }
}

export const show3DBuildings = ref(loadSetting(BUILDINGS_3D_KEY));

export function toggle3DBuildings(): void {
  show3DBuildings.value = !show3DBuildings.value;
  saveSetting(BUILDINGS_3D_KEY, show3DBuildings.value);
}

export const mapRotationEnabled = ref(loadSetting(ROTATION_KEY));

export function toggleMapRotation(): void {
  mapRotationEnabled.value = !mapRotationEnabled.value;
  saveSetting(ROTATION_KEY, mapRotationEnabled.value);
}
