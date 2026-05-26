import { ref } from "vue";

const STORAGE_KEY = "show-3d-buildings";

function getInitialPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export const show3DBuildings = ref<boolean>(getInitialPreference());

export function useBuildings3D() {
  function toggle() {
    show3DBuildings.value = !show3DBuildings.value;
    try {
      localStorage.setItem(STORAGE_KEY, String(show3DBuildings.value));
    } catch {
      // localStorage may be unavailable (private mode); preference stays in-memory only
    }
  }

  return { show3DBuildings, toggle };
}
