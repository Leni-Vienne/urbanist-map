import { computed } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import {
  createLocalOverlayContribution,
  createLocalProjectContribution,
} from "@/utils/projectFactories";
import type { RouterOutput } from "@/client";

// AI : Type for user contributions from backend
export type UserContribution = RouterOutput["project"]["getUsersContributions"]["projects"][number];
// AI : Extended to include imageUrl for local overlays that aren't yet uploaded
export type UserContributionOverlay = UserContribution["overlays"][number] & {
  imageUrl?: string;
};

/**
 * AI : Composable to merge local-only contributions (status === null) with backend contributions
 * AI : This allows My Contributions panel to show unsaved/unsubmitted work alongside submitted work
 * AI : Note: Local contributions have status===null which isn't in the backend type, but we handle this via type assertions
 */
export function useAllContributions() {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();

  /**
   * AI : Merged contributions combining backend data with local-only projects/overlays
   */
  const allContributions = computed<UserContribution[]>(() => {
    const user = authStore.user;
    if (!user) return [];

    // AI : Start with backend contributions
    const backendContributions = [...projectStore.userContributions];

    // AI : Create a map for quick lookup and modification
    const contributionsMap = new Map<string, UserContribution>();
    for (const contrib of backendContributions) {
      contributionsMap.set(contrib.id, { ...contrib });
    }

    // AI : Add local-only overlays to their parent projects
    // AI : Note: We don't filter by authorId here because overlays can be added to projects
    // AI : the user doesn't own. The project ownership filtering handles access control.
    const localOverlays = Object.values(overlayStore.overlays).filter(
      (overlay) => overlay.status === null || overlay.status === undefined,
    );

    for (const overlay of localOverlays) {
      if (!overlay.projectId) continue;

      // AI : Check if parent project exists in contributions
      let parentProject = contributionsMap.get(overlay.projectId);

      if (parentProject) {
        // AI : Project exists - add local overlay to it using factory
        const localOverlayData = createLocalOverlayContribution(
          overlay,
          {
            cityId: parentProject.cityId,
            cityName: parentProject.cityName,
            countryCode: parentProject.countryCode,
            countryName: parentProject.countryName,
          },
          user.username ?? null,
        );

        // AI : Check if overlay already exists (avoid duplicates)
        if (!parentProject.overlays.some((o) => o.id === overlay.id)) {
          parentProject = {
            ...parentProject,
            overlays: [...parentProject.overlays, localOverlayData],
            overlayCount: parentProject.overlayCount + 1,
          };
          contributionsMap.set(overlay.projectId, parentProject);
        }
      } else {
        // AI : Parent project not in backend contributions
        // AI : Check if it exists in local projects store
        const localProject = projectStore.projects[overlay.projectId];

        if (localProject && localProject.ownerId === user.id) {
          // AI : Use factory to create new contribution entry for local project
          const newContribution = createLocalProjectContribution(
            localProject,
            overlay,
            user.username ?? null,
          );

          contributionsMap.set(localProject.id, newContribution);
        }
      }
    }

    // AI : Add local-only projects (without overlays or with only local overlays)
    const localProjects = Object.values(projectStore.projects).filter(
      (project) =>
        (project.status === null || project.status === undefined) && project.ownerId === user.id,
    );

    for (const localProject of localProjects) {
      // AI : Skip if already added above (when processing local overlays)
      if (contributionsMap.has(localProject.id)) continue;

      // AI : Get all local overlays for this project
      const projectLocalOverlays = localOverlays.filter((o) => o.projectId === localProject.id);

      const overlayData = projectLocalOverlays.map((overlay) =>
        createLocalOverlayContribution(
          overlay,
          {
            cityId: localProject.cityId,
            cityName: localProject.city.name,
            countryCode: localProject.city.countryCode,
            countryName: null,
          },
          user.username ?? null,
        ),
      );

      const newContribution = {
        id: localProject.id,
        name: localProject.name,
        description: localProject.description ?? null,
        status: null, // AI : Local-only project
        version: 1,
        ownerId: localProject.ownerId,
        ownerUsername: user.username ?? null,
        ownerApprovedCount: null,
        ownerRejectedCount: null,
        cityId: localProject.cityId,
        cityName: localProject.city.name,
        countryCode: localProject.city.countryCode,
        countryName: null,
        lat: localProject.lat,
        lng: localProject.lng,
        proposalDate: localProject.proposalDate,
        startDate: localProject.startDate,
        endDate: localProject.endDate,
        sourceUrl: localProject.sourceUrl ?? null,
        latestUpdateOn: localProject.latestUpdateOn ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        overlays: overlayData,
        overlayCount: overlayData.length,
      } as unknown as UserContribution;

      contributionsMap.set(localProject.id, newContribution);
    }

    // AI : Convert map back to array and sort by updated date (most recent first)
    const result = [...contributionsMap.values()].toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return result;
  });

  return {
    allContributions,
  };
}
