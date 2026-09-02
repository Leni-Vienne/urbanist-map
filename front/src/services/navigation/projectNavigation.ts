import type { LngLatBounds } from "maplibre-gl";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { openProjectDetailById } from "@/services/core/projectSelection";

/**
 * Navigate to a project by coordinates. Opens the detail and flies to the point concurrently;
 * the detail resolves the project by id and so does not depend on the camera or on rendered tiles.
 */
export function navigateToProject(lat: number, lng: number, projectId: string): void {
  try {
    openProjectDetailById(projectId);
    // Drawer-aware padding centers the feature in the map area above the mobile drawer (desktop
    // centers it in the full viewport).
    mobileAwareFlyTo([lat, lng], 18);
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}

/**
 * Navigate to a project by fitting its geometry bounds, then selecting it. Use when the
 * project has real geometry bounds rather than a single marker point.
 */
export function navigateToProjectBounds(bounds: LngLatBounds, projectId: string): void {
  try {
    openProjectDetailById(projectId);
    mobileAwareFlyToBounds(bounds, { maxZoom: 18 });
  } catch (error) {
    console.error("Failed to navigate to marker project bounds:", error);
    throw error;
  }
}
