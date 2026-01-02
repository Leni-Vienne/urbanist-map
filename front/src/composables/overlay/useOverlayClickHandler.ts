import {
  navigateToOverlayWithCity,
  navigateToStandaloneProject,
} from "@/composables/navigation/useOverlayNavigation";
import { navigateToOverlay } from "@/composables/overlay/useOverlay";
import { switchMode } from "@/composables/overlay/useOverlayModes";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { trpc } from "@/client";
import type { OverlayForModeration, LatestContribution } from "@/types/index";

// AI : Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = OverlayForModeration | LatestContribution;

/**
 * AI : Shared composable for handling overlay clicks from moderation/contribution panels
 * AI : Handles pending overlay visibility and proper navigation flow
 */
export function useOverlayClickHandler() {
  const toast = useToast();

  /**
   * AI : Navigate to an overlay, handling all necessary state changes
   * AI : - Switches to edit mode if in view mode (required to see pending overlays)
   * AI : - In moderation mode, don't switch modes (pending overlays already visible)
   * AI : - Clears city cache to force reload
   * AI : - Uses city-aware navigation when possible for better UX
   * @param autoSelect - Whether to auto-select overlay after navigation (default: true)
   */
  async function handleOverlayClickNavigation(
    overlay: NavigableOverlay,
    shouldToggleEditMode = false,
    autoSelect = true,
  ): Promise<void> {
    try {
      const overlayStore = useOverlayStore();
      const mapStore = useMapStore();

      // AI : For rejected or replaced overlays, navigate to project coordinates instead
      if (overlay.status === "rejected" || overlay.status === "replaced") {
        // AI : Check if overlay is OverlayForModeration with project coordinates
        if ("projectId" in overlay && overlay.projectId) {
          // AI : Get project from userContributions to get coordinates
          try {
            const contributions = await trpc.project.getUsersContributions.query({ limit: 100 });
            const project = contributions.projects.find((p) => p.id === overlay.projectId);

            if (project && project.lat && project.lng && project.cityId && project.cityName) {
              await navigateToStandaloneProject(
                project.lat,
                project.lng,
                project.cityId,
                project.cityName,
                project.countryCode ?? undefined,
                project.id,
              );
            }
          } catch (error) {
            console.error("Failed to navigate to project:", error);
          }
        }
        return;
      }

      // AI : Only switch to edit mode if currently in view mode
      // AI : In moderation mode, pending overlays are already visible, so don't switch
      if (overlayStore.mode === "view" && shouldToggleEditMode) {
        await switchMode("edit");

        // AI : Only show toast for pending overlays (for approved ones it's less critical)
        if (overlay.status === "pending") {
          toast.add({
            severity: "info",
            summary: "Switched to Edit Mode",
            detail: "Pending overlays are only visible in edit mode",
            life: 3000,
          });
        }

        // AI : Wait for edit mode transition to complete and overlays to re-render
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // AI : If overlay has city info, navigate via city (loads city markers and overlays first)
      if (overlay.cityId && overlay.cityName) {
        await navigateToOverlayWithCity(
          overlay.id,
          overlay.cityId,
          overlay.cityName,
          overlay.countryCode ?? undefined,
          autoSelect,
        );
      } else {
        // AI : Fallback to direct navigation if no city info
        await navigateToOverlay(overlay.id, true, true);
      }
    } catch (error) {
      console.error("Failed to navigate to overlay:", error);
      toast.add({
        severity: "error",
        summary: "Navigation Failed",
        detail: error instanceof Error ? error.message : "Failed to navigate to overlay",
        life: 3000,
      });
    }
  }

  return {
    handleOverlayClickNavigation,
  };
}
