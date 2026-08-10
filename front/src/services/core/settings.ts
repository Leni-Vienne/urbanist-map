import { ref } from "vue";

// Persisted map display settings. Module-level singleton refs so components (menus, controls)
// and map services can read or watch the same state; toggles write through to localStorage.

const BUILDINGS_3D_KEY = "show-3d-buildings";
const ROTATION_KEY = "map-rotation-enabled";
const FILTERS_SEEN_KEY = "filters-seen";

function loadSetting(storageKey: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? fallback : stored !== "false";
  } catch {
    return fallback;
  }
}

function saveSetting(storageKey: string, value: boolean): void {
  try {
    localStorage.setItem(storageKey, String(value));
  } catch {
    // localStorage may be unavailable (private mode); preference stays in-memory only
  }
}

// The map ships with both display settings enabled.
export const show3DBuildings = ref(loadSetting(BUILDINGS_3D_KEY, true));

export function toggle3DBuildings(): void {
  show3DBuildings.value = !show3DBuildings.value;
  saveSetting(BUILDINGS_3D_KEY, show3DBuildings.value);
}

export const mapRotationEnabled = ref(loadSetting(ROTATION_KEY, true));

export function toggleMapRotation(): void {
  mapRotationEnabled.value = !mapRotationEnabled.value;
  saveSetting(ROTATION_KEY, mapRotationEnabled.value);
}

// Whether the filter surface has ever been opened, so its entry point can wear a hint dot until it
// has been found once.
export const filtersSeen = ref(loadSetting(FILTERS_SEEN_KEY, false));

export function markFiltersSeen(): void {
  if (filtersSeen.value) return;
  filtersSeen.value = true;
  saveSetting(FILTERS_SEEN_KEY, true);
}
