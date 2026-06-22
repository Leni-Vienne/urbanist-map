import { ref } from "vue";

const STORAGE_KEY = "map-layer-mode";

type MapLayerMode = "default" | "alternative";

function getInitialMode(): MapLayerMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "default" ? "default" : "alternative";
  } catch {
    return "alternative";
  }
}

export const mapLayerMode = ref<MapLayerMode>(getInitialMode());

export function useMapLayerMode() {
  function toggle() {
    const next: MapLayerMode = mapLayerMode.value === "alternative" ? "default" : "alternative";
    mapLayerMode.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode); preference stays in-memory only
    }
    // The map source/style is wired at build time from the stored mode, so reload to rebuild it.
    location.reload();
  }

  return { mapLayerMode, toggle };
}
