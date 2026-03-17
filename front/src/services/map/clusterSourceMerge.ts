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
import { trpc } from "@/client";
import { useAuthStore } from "@/stores/authStore";

let globalPendingPoints: {
  id: string;
  lat: number | null;
  lng: number | null;
  tags: string[] | null;
  name: string;
  status: string;
}[] = [];

/**
 * Fetch lightweight pending points globally for the current mode.
 * Call this when switching to edit or moderation mode.
 */
export async function updateGlobalPendingPoints(mode: AppMode): Promise<void> {
  if (mode === "view") {
    globalPendingPoints = [];
    return;
  }
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) {
    globalPendingPoints = [];
    return;
  }
  try {
    globalPendingPoints = await trpc.viewport.getGlobalPendingPoints.query({ mode });
  } catch (err) {
    console.error("Failed to fetch global pending points", err);
    globalPendingPoints = [];
  }
}

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
  if (mode === "view") {
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

  // We also want to track which base projects need their is_pending flag set to true
  const baseProjectsToOverride = new Set<string>();

  // Extract projects from overlay data (projects that have overlays)
  for (const overlay of overlaysData) {
    const project = overlay.project;
    if (!project || !project.lat || !project.lng) continue;
    const isPending = project.status !== "approved" || overlay.status !== "approved";

    if (baseProjectIds.has(project.id)) {
      if (isPending) baseProjectsToOverride.add(project.id);
      continue;
    }
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
        is_pending: isPending,
      },
    });
  }

  // Extract projects from standalone projects data
  for (const project of projectsData) {
    if (!project.lat || !project.lng) continue;
    const isPending = project.status !== "approved";

    if (baseProjectIds.has(project.id)) {
      if (isPending) baseProjectsToOverride.add(project.id);
      continue;
    }
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
        is_pending: isPending,
      },
    });
  }

  // Extract projects from global pending points
  for (const project of globalPendingPoints) {
    if (!project.lat || !project.lng) continue;
    // By definition, global pending points contain some pending element
    const isPending = true;

    if (baseProjectIds.has(project.id)) {
      baseProjectsToOverride.add(project.id);
      continue;
    }
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
        is_pending: isPending,
      },
    });
  }

  // If no pending projects to add or override, just use the base source
  if (pendingProjects.size === 0 && baseProjectsToOverride.size === 0) {
    updateProjectPointsSource(baseGeojson);
    return;
  }

  // Map over base features and override is_pending if needed
  const modifiedBaseFeatures = baseGeojson.features.map((feature) => {
    const id = feature.properties?.id ?? feature.id;
    if (id && baseProjectsToOverride.has(String(id))) {
      return {
        ...feature,
        properties: {
          ...feature.properties,
          is_pending: true,
        },
      };
    }
    return feature;
  });

  // Merge: base features + pending features
  const mergedGeojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [...modifiedBaseFeatures, ...pendingProjects.values()],
  };

  updateProjectPointsSource(mergedGeojson);
}
