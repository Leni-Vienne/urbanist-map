/**
 * clusterSourceMerge.ts — augments the MapLibre cluster source with pending projects.
 *
 * In edit/moderation modes, the base /api/projects/points FeatureCollection only
 * contains approved projects. This module merges in pending/user-owned projects
 * from the bbox tRPC fetch so they appear in the cluster source immediately.
 *
 * In view mode (or when called with empty data), restores the base unaugmented source.
 */

import { useProjectPointsStore } from "@/stores/pinia/projectPointsStore";
import { updateProjectPointsSource } from "@/services/map/tileLayers";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

/**
 * Merge pending projects from bbox fetch into the cluster source.
 * Call after each viewport fetch in edit/moderation modes.
 * Call with empty arrays when switching to view mode to restore the base source.
 */
export function mergeProjectPointsForMode(
  overlaysData: OverlayData[],
  projectsData: {
    id: string;
    lat: number | null;
    lng: number | null;
    name: string;
    tags: string[] | null;
    status: string;
  }[],
  mode: AppMode,
): void {
  const projectPointsStore = useProjectPointsStore();
  const baseGeojson = projectPointsStore.geojson;
  if (!baseGeojson) return;

  // In view mode, just restore the base source (remove any prior augmentation)
  if (mode === "view" || (overlaysData.length === 0 && projectsData.length === 0)) {
    updateProjectPointsSource(baseGeojson);
    return;
  }

  // Collect project IDs already in the base source
  const baseProjectIds = new Set<string>();
  for (const feature of baseGeojson.features) {
    const id = feature.properties?.id ?? feature.id;
    if (id) baseProjectIds.add(String(id));
  }

  // Collect unique pending projects from both overlays and standalone projects data
  const pendingProjects = new Map<string, GeoJSON.Feature>();

  // Extract projects from overlay data (projects that have overlays)
  for (const overlay of overlaysData) {
    const project = overlay.project;
    if (!project || !project.lat || !project.lng) continue;
    if (baseProjectIds.has(project.id)) continue;
    if (pendingProjects.has(project.id)) continue;

    pendingProjects.set(project.id, {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [project.lng, project.lat],
      },
      properties: {
        id: project.id,
        name: project.name,
        tags: project.tags,
      },
    });
  }

  // Extract projects from standalone projects data
  for (const project of projectsData) {
    if (!project.lat || !project.lng) continue;
    if (baseProjectIds.has(project.id)) continue;
    if (pendingProjects.has(project.id)) continue;

    pendingProjects.set(project.id, {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [project.lng, project.lat],
      },
      properties: {
        id: project.id,
        name: project.name,
        tags: project.tags,
      },
    });
  }

  // If no pending projects to add, just use the base source
  if (pendingProjects.size === 0) {
    updateProjectPointsSource(baseGeojson);
    return;
  }

  // Merge: base features + pending features
  const mergedGeojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [...baseGeojson.features, ...pendingProjects.values()],
  };

  updateProjectPointsSource(mergedGeojson);
}
