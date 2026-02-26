import {
  navigateToOverlayWithCity,
  navigateToStandaloneProject,
} from "@/services/navigation/overlayNavigation";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { navigateToOverlay } from "@/services/overlay/overlayActions";
import { switchMode } from "@/services/overlay/modeSwitching";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/composables/ui/useToast";
import { trpc } from "@/client";
import type { OverlayForModeration, LatestContribution } from "@/types/index";
import { requestScrollTo } from "@/services/layout/accordionState";

// AI : Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = OverlayForModeration | LatestContribution;

/**
 * AI : Check if current user can moderate a given country
 * AI : Admins can moderate all countries, moderators only their assigned ones
 */
export function canModerateCountry(countryCode: string): boolean {
  const authStore = useAuthStore();
  const user = authStore.user;
  if (!user) return false;
  // AI : Admins (role=admin or moderatedCountries=null) can moderate everything
  if (
    user.role === "admin" ||
    user.moderatedCountries === null ||
    user.moderatedCountries === undefined
  ) {
    return true;
  }
  return user.moderatedCountries.includes(countryCode);
}

/**
 * AI : Auto-select a country in the moderation store (if not already selected)
 * AI : Called when clicking a contribution in moderation mode
 */
export function syncModerationCountry(countryCode: string): void {
  const moderationStore = useModerationStore();
  if (moderationStore.selectedCountryCode !== countryCode) {
    moderationStore.setSelectedCountryCode(countryCode);
  }
}

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

      // AI : For rejected or replaced overlays, navigate to overlay's centroid if available
      // AI : Otherwise fall back to project center
      if (overlay.status === "rejected" || overlay.status === "replaced") {
        await navigateToReplacedOrRejectedOverlay(overlay, overlayStore);
        return;
      }

      // AI : In moderation mode, auto-select the contribution's country for the moderation panel
      // AI : If moderator doesn't have access to this country, block navigation with a toast
      if (overlayStore.mode === "moderation" && overlay.countryCode) {
        if (!canModerateCountry(overlay.countryCode)) {
          toast.add({
            severity: "warn",
            summary: "Moderation",
            detail: "You do not have permission to moderate this country.",
            life: 4000,
          });
          return;
        }
        // AI : Auto-select the country so ModerationPanel loads its pending submissions
        syncModerationCountry(overlay.countryCode);
      }

      // AI : Only switch to edit mode if currently in view mode
      // AI : In moderation mode, pending overlays are already visible, so don't switch
      if (overlayStore.mode === "view" && shouldToggleEditMode) {
        switchMode("edit");

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
        await new Promise<void>((resolve) => void setTimeout(() => resolve(), 100));
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
        await navigateToOverlay(overlay.id, true, autoSelect);
      }

      // AI : Request scroll to overlay in adjacent panels
      requestScrollTo("overlay", overlay.id);
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

/**
 * AI : Handle navigation for replaced or rejected overlays
 * AI : Tries to use overlay centroid from store, falls back to project center
 */
async function navigateToReplacedOrRejectedOverlay(
  overlay: NavigableOverlay,
  overlayStore: ReturnType<typeof useOverlayStore>,
): Promise<void> {
  if (!("projectId" in overlay) || !overlay.projectId) {
    return;
  }

  // AI : First try to get centroid from overlay store (has full overlay data)
  const overlayFromStore = overlayStore.overlays[overlay.id];
  if (overlayFromStore?.corners && overlayFromStore.corners.length >= 4) {
    // AI : Calculate centroid from corners
    const centroidLat =
      overlayFromStore.corners.reduce((sum, c) => sum + c.lat, 0) / overlayFromStore.corners.length;
    const centroidLng =
      overlayFromStore.corners.reduce((sum, c) => sum + c.lng, 0) / overlayFromStore.corners.length;

    // AI : Use mobileAwareFlyTo for proper navigation
    mobileAwareFlyTo([centroidLat, centroidLng], 18, {
      duration: 1.5,
      easeLinearity: 0.25,
    });
    return;
  }

  // AI : Fallback: navigate to project coordinates
  try {
    const contributions = await trpc.project.getUsersContributions.query({ limit: 100 });
    const project = contributions.projects.find((p) => p.id === overlay.projectId);

    if (project?.lat && project.lng && project.cityId && project.cityName) {
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
