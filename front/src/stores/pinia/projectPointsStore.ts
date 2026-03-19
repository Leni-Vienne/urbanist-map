/**
 * projectPointsStore — holds the /api/projects/points GeoJSON FeatureCollection.
 *
 * Fetched once on app init (fully public, aggressive Cache-Control on the server).
 * Pushed into the MapLibre 'project-points' cluster source via updateProjectPointsSource()
 * both on initial fetch and once the MapLibre map becomes ready (whichever is later).
 *
 * Call fetchProjectPoints() again after a moderation approval/rejection to refresh
 * the cluster source without a full page reload.
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { onMlMapReady, updateProjectPointsSource } from "@/services/map/tileLayers";
import { getApiUrl } from "@/client";

/** Compact format from backend: [id, lat, lng, tags, timelineStatus][] */
type CompactPoint = [id: string, lat: number, lng: number, tags: string[], timelineStatus: string];

/** Decode compact points array into GeoJSON FeatureCollection */
function decodeCompactPoints(points: CompactPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(([id, lat, lng, tags, timelineStatus]) => ({
      type: "Feature" as const,
      id,
      geometry: {
        type: "Point" as const,
        coordinates: [lng, lat],
      },
      properties: { tags, timelineStatus },
    })),
  };
}

export const useProjectPointsStore = defineStore("projectPoints", () => {
  const geojson = ref<GeoJSON.FeatureCollection | null>(null);

  async function fetchProjectPoints(): Promise<void> {
    try {
      const response = await fetch(`${getApiUrl()}/api/projects/points`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { points: CompactPoint[] };
      const decoded = decodeCompactPoints(data.points);
      geojson.value = decoded;
      // Push to MapLibre source if the map is already ready; no-op otherwise
      // (the onMlMapReady callback in init() handles the map-ready-after-fetch case).
      updateProjectPointsSource(decoded);
    } catch (error) {
      console.error("Failed to fetch project points:", error);
    }
  }

  /**
   * Call once on map init. Starts the fetch and registers an mlMap-ready callback
   * to handle the race where the map loads after the fetch completes.
   */
  function init(): void {
    fetchProjectPoints();

    // If mlMap becomes ready after the fetch, re-push the already-fetched data.
    onMlMapReady(() => {
      if (geojson.value) {
        updateProjectPointsSource(geojson.value);
      }
    });
  }

  return { geojson, init, fetchProjectPoints };
});
