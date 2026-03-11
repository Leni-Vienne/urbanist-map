// Unified entity removal service
// Centralizes logic for removing projects and overlays from stores, map, and caches
// Extracted from composables to separate business logic from Vue context

import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { map } from "@/services/core/map";
import { clearEntry as clearRegistryEntry } from "@/services/overlay/overlayRenderRegistry";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
} from "@/services/map/standaloneProjectMarkers";
import { trpc } from "@/client";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";

// Options for deleteOverlayDirect, allowing callers to customize behavior
interface DeleteOverlayOptions {
  showToast?: boolean;
  updateUserContributions?: boolean;
  clearCityCaches?: boolean;
}

/**
 * Remove overlay from map layers and overlay store
 */
export function removeOverlayFromMapAndStore(overlayId: string) {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  // Remove Leaflet layer and marker from map via registry
  clearRegistryEntry(overlayId);

  // Remove from store
  delete overlayStore.overlays[overlayId];

  // Clear specific caches
  overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter((o) => o.id !== overlayId);
  overlayStore.loadedEditOverlays.delete(overlayId);

  // Reset selection if needed
  if (overlayStore.idSelectedOverlay === overlayId) {
    overlayStore.idSelectedOverlay = null;
  }

  // Clear any pending modifications for this overlay (prevents stale entries in submission dialog)
  usePendingModificationsStore().clearModification(overlayId);
}

/**
 * Remove project standalone marker from map
 */
function removeProjectMarkerFromMap(projectId: string) {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (marker && map.value.hasLayer(marker)) {
    map.value.removeLayer(marker);
  }
}

/**
 * Comprehensive overlay removal
 * Handles Store, Map, Cache, Project Association, and Standalone Marker restoration
 */
function removeOverlay(
  overlayId: string,
  options: {
    updateUserContributions?: boolean;
    clearCityCaches?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const authStore = useAuthStore();

  // 1. Find parent project to update its overlay list
  const allProjectsData = projectStore.projects;
  // Find project by overlayIds array (most reliable source)
  const projectWithOverlay = Object.values(allProjectsData).find((p) =>
    p.overlayIds.includes(overlayId),
  );

  if (projectWithOverlay) {
    // Update project overlay list
    const updatedOverlayIds = projectWithOverlay.overlayIds.filter((id) => id !== overlayId);
    projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds });

    // 2. Restore standalone marker if this was the last overlay
    const isLastOverlay = updatedOverlayIds.length === 0;
    if (isLastOverlay && projectWithOverlay.lat && projectWithOverlay.lng) {
      // Small delay ensures map is ready after removal animations
      setTimeout(() => {
        addStandaloneProjectMarkerForProject(projectWithOverlay);
      }, 150);
    }
  }

  // 3. Remove native map layers and store entries
  removeOverlayFromMapAndStore(overlayId);

  // 4. Update interactions with other stores
  if (options.updateUserContributions) {
    projectStore.removeOverlayFromUserContributions(overlayId, authStore.user?.id);
  }

  if (options.clearCityCaches) {
    mapStore.clearCityCaches();
  }

  // Also remove standalone marker for this specific overlay ID (legacy/edge case support)
  removeProjectMarkerFromMap(overlayId);
}

/**
 * Comprehensive project removal
 * Removes project and all its associated overlays
 */
export function removeProject(
  projectId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();

  const project = projectStore.projects[projectId];

  // 1. Clean up standalone project marker
  const hasNoOverlays = !project?.overlayIds || project.overlayIds.length === 0;
  if (hasNoOverlays) {
    removeProjectMarkerFromMap(projectId);
  }

  // 2. Remove all associated overlays
  if (project?.overlayIds) {
    for (const overlayId of project.overlayIds) {
      removeOverlayFromMapAndStore(overlayId);
    }
  }

  // 3. Remove project from store
  if (projectStore.projects[projectId]) {
    delete projectStore.projects[projectId];
  }

  // 4. Update auxiliary stores
  if (options.updateUserContributions) {
    projectStore.removeProjectFromUserContributions(projectId);
  }

  // 5. Force cache clear to prevent ghost data
  mapStore.clearCityCaches();
}

/**
 * Non-composable overlay deletion function that can be called from anywhere
 * Safe to call from Leaflet toolbar handlers
 * Returns true if deletion was successful
 */
export async function deleteOverlayDirect(
  overlayId: string,
  options: DeleteOverlayOptions = {},
): Promise<boolean> {
  const { showToast = false, updateUserContributions = false, clearCityCaches = false } = options;

  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];

  try {
    // Check if overlay exists in backend (has a status)
    // Brand new overlays (status === null or undefined) only exist locally
    // Using ?? to check for null/undefined - if status is null/undefined, existsInBackend = false
    const existsInBackend = (overlayObject?.status ?? null) !== null;

    if (existsInBackend) {
      // Overlay exists in backend, call API to delete it
      // If it throws, the outer catch handles it and returns false
      await trpc.overlay.deleteOverlay.mutate({ id: overlayId });
    }

    removeOverlay(overlayId, { updateUserContributions, clearCityCaches });

    if (showToast) {
      const toast = useToast();
      toast.add({
        severity: "success",
        summary: t("contribute.overlayDeleted"),
        life: 3000,
      });
    }
    return true;
  } catch (error) {
    console.error("Failed to delete overlay:", error);
    return false;
  }
}
