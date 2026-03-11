import { computed } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import {
  createLocalOverlayContribution,
  createLocalProjectContribution,
} from "@/utils/projectFactories";
import { deleteOverlayDirect, removeProject } from "@/services/core/entityRemoval";

import type { UserContribution } from "@/types/index";

export function useUserContributions() {
  const projectStore = useProjectStore();
  const toast = useToast();

  const isLoading = computed(() => projectStore.userContributionsLoading);
  const projects = computed(() => projectStore.userContributions);

  /**
   * Merged contributions combining backend data with local-only projects/overlays
   * This allows My Contributions panel to show unsaved/unsubmitted work alongside submitted work
   */
  const allContributions = computed<UserContribution[]>(() => {
    const authStore = useAuthStore();
    const overlayStore = useOverlayStore();
    const user = authStore.user;

    if (!user) return [];

    // Start with backend contributions
    const backendContributions = [...projectStore.userContributions];

    // Create a map for quick lookup and modification
    const contributionsMap = new Map<string, UserContribution>();
    for (const contrib of backendContributions) {
      contributionsMap.set(contrib.id, { ...contrib });
    }

    // Add local-only overlays to their parent projects
    // Note: We don't filter by authorId here because overlays can be added to projects
    // the user doesn't own. The project ownership filtering handles access control.
    const localOverlays = Object.values(overlayStore.overlays).filter(
      (overlay) => overlay.status === null,
    );

    for (const overlay of localOverlays) {
      if (!overlay.projectId) continue;

      // Check if parent project exists in contributions
      let parentProject = contributionsMap.get(overlay.projectId);

      if (parentProject) {
        // Project exists - add local overlay to it using factory
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

        // Check if overlay already exists (avoid duplicates)
        if (!parentProject.overlays.some((o) => o.id === overlay.id)) {
          parentProject = {
            ...parentProject,
            overlays: [...parentProject.overlays, localOverlayData],
            overlayCount: parentProject.overlayCount + 1,
          };
          contributionsMap.set(overlay.projectId, parentProject);
        }
      } else {
        // Parent project not in backend contributions
        // Check if it exists in local projects store
        const localProject = projectStore.projects[overlay.projectId];

        if (localProject && localProject.ownerId === user.id) {
          // Use factory to create new contribution entry for local project
          const newContribution = createLocalProjectContribution(
            localProject,
            overlay,
            user.username ?? null,
          );

          contributionsMap.set(localProject.id, newContribution);
        }
      }
    }

    // Add local-only projects (without overlays or with only local overlays)
    const localProjects = Object.values(projectStore.projects).filter(
      (project) => project.status === null && project.ownerId === user.id,
    );

    for (const localProject of localProjects) {
      // Skip if already added above (when processing local overlays)
      if (contributionsMap.has(localProject.id)) continue;

      // Get all local overlays for this project
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
        status: null, // Local-only project
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
        createdAt: new Date(),
        updatedAt: new Date(),
        overlays: overlayData,
        overlayCount: overlayData.length,
      } as unknown as UserContribution;

      contributionsMap.set(localProject.id, newContribution);
    }

    // Convert map back to array and sort by updated date (most recent first)
    const result = [...contributionsMap.values()].toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return result;
  });

  async function fetchUserContributions(options?: {
    cityId?: number;
    includeCityProjects?: boolean;
  }) {
    const authStore = useAuthStore();
    if (!authStore.user) return;

    // Use cache key helper from store to avoid duplication
    const cacheKey = projectStore.getUserContributionsCacheKey(options);

    // Check if we already have this data cached
    if (projectStore.userContributionsCache.has(cacheKey)) {
      // Load from cache
      projectStore.userContributions = projectStore.userContributionsCache.get(cacheKey) ?? [];
      return;
    }

    projectStore.setUserContributionsLoading(true);
    try {
      const result = await withErrorHandling(
        async () =>
          trpc.project.getUsersContributions.query({
            limit: 50,
            cityId: options?.cityId,
            includeCityProjects: options?.includeCityProjects,
          }),
        { errorMessage: "Failed to load contributions. Please refresh the page." },
      );

      if (result) {
        projectStore.setUserContributions(result.projects, cacheKey);
      }
    } finally {
      projectStore.setUserContributionsLoading(false);
    }
  }

  async function deleteOverlay(overlayId: string): Promise<boolean> {
    // Delegate to deleteOverlayDirect with composable-appropriate options
    return deleteOverlayDirect(overlayId, {
      showToast: true,
      updateUserContributions: true,
      clearCityCaches: true,
    });
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    try {
      // Get project to check if it's local-only (not submitted to backend)
      const project = projectStore.projects[projectId];
      const isLocalOnly = project?.status === null;

      // For local-only projects, skip backend call and just remove from local state
      if (isLocalOnly) {
        // Use new unified removal service
        removeProject(projectId, { updateUserContributions: false });

        toast.add({
          severity: "success",
          summary: t("contribute.projectDeleted"),
          life: 3000,
        });
        return true;
      }

      // For backend projects, call the API
      const result = await withErrorHandling(
        async () => trpc.project.deleteProject.mutate({ id: projectId }),
        { errorMessage: t("contribute.deleteProjectError") },
      );

      if (result) {
        // Use new unified removal service
        removeProject(projectId, { updateUserContributions: true });

        toast.add({
          severity: "success",
          summary: t("contribute.projectDeleted"),
          life: 3000,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting project:", error);
      return false;
    }
  }

  return {
    isLoading,
    projects,
    fetchUserContributions,
    deleteOverlay,
    deleteProject,
    allContributions,
  };
}
