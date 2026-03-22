/**
 * clusterSourceMerge.ts - builds the GeoJSON source for pending projects.
 *
 * In edit/moderation modes, this module collects pending/user-owned projects
 * from the bbox tRPC fetch and updates the pending-project-points source.
 */

import { updatePendingProjectPointsSource } from "@/services/map/tileLayers";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { trpc } from "@/client";
import { useAuthStore } from "@/stores/authStore";

let globalPendingPoints: {
  id: string;
  lat: number | null;
  lng: number | null;
  tags: string[] | null;
  name: string | null;
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
  } catch (error) {
    console.error("Failed to fetch global pending points", error);
    globalPendingPoints = [];
  }
}

/**
 * Create a GeoJSON Feature for a project point
 */
function createProjectFeature(
  project: {
    id: string;
    lat: number;
    lng: number;
    name: string | null;
    tags: string[] | null;
  },
  isPending: boolean,
): GeoJSON.Feature {
  return {
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
  };
}

/**
 * Add a project to the pending projects map if it meets criteria
 */
function addProjectToMap(
  project: {
    id: string;
    lat: number | null;
    lng: number | null;
    name: string | null;
    tags: string[] | null;
  },
  isPending: boolean,
  pendingProjects: Map<string, GeoJSON.Feature>,
): void {
  if (!project.lat || !project.lng || !isPending) return;
  if (pendingProjects.has(project.id)) return;

  pendingProjects.set(
    project.id,
    createProjectFeature(
      {
        id: project.id,
        lat: project.lat,
        lng: project.lng,
        name: project.name,
        tags: project.tags,
      },
      isPending,
    ),
  );
}

/**
 * Merge pending projects from bbox fetch into the geojson source.
 * Call after each viewport fetch in edit/moderation modes.
 */
export function mergeProjectPointsForMode(
  overlaysData: OverlayData[],
  projectsData: {
    id: string;
    lat: number | null;
    lng: number | null;
    name: string | null;
    tags: string[] | null;
    status: string;
  }[],
  mode: AppMode,
): void {
  const emptyGeojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  if (mode === "view") {
    updatePendingProjectPointsSource(emptyGeojson);
    return;
  }

  const pendingProjects = new Map<string, GeoJSON.Feature>();

  for (const overlay of overlaysData) {
    const project = overlay.project;
    if (!project?.lat || !project.lng) continue;
    const isPending = project.status !== "approved" || overlay.status !== "approved";
    addProjectToMap(project, isPending, pendingProjects);
  }

  for (const project of projectsData) {
    const isPending = project.status !== "approved";
    addProjectToMap(project, isPending, pendingProjects);
  }

  for (const project of globalPendingPoints) {
    addProjectToMap(project, true, pendingProjects);
  }

  if (pendingProjects.size === 0) {
    updatePendingProjectPointsSource(emptyGeojson);
    return;
  }

  const mergedGeojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [...pendingProjects.values()],
  };

  updatePendingProjectPointsSource(mergedGeojson);
}
