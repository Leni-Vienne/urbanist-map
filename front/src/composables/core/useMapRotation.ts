import { ref } from "vue";

const STORAGE_KEY = "map-rotation-enabled";

function getInitialPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

// Default: rotation enabled, matching the map's out-of-the-box behavior.
export const mapRotationEnabled = ref<boolean>(getInitialPreference());

export function useMapRotation() {
  function toggle() {
    mapRotationEnabled.value = !mapRotationEnabled.value;
    try {
      localStorage.setItem(STORAGE_KEY, String(mapRotationEnabled.value));
    } catch {
      // localStorage may be unavailable (private mode); preference stays in-memory only
    }
  }

  return { mapRotationEnabled, toggle };
}
