import { computed } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { createLocalOverlayContribution } from "@/utils/projectFactories";
import { getStagedRender } from "@/composables/submission/stagedRenderStore";
import { deleteOverlayDirect, removeProject } from "@/services/core/entityRemoval";
import type { Project, UserContribution, UserContributionOverlay } from "@/types/index";

function buildLocalContribution(
  project: Project,
  overlays: UserContributionOverlay[],
  username: string | null,
): UserContribution {
  return {
    ...project,
    overlays,
    overlayIds: overlays.map((o) => o.id),
    countryName: project.countryName ?? null,
    ownerUsername: username,
  };
}

async function deleteOverlay(overlayId: string): Promise<boolean> {
  // Delegate to deleteOverlayDirect with composable-appropriate options
  return deleteOverlayDirect(overlayId, {
    showToast: true,
    updateUserContributions: true,
  });
}

export function useUserContributions() {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const toast = useToast();

  const isLoading = computed(() => projectStore.userContributionsLoading);

  /**
   * Merged contributions combining backend data with local-only projects/overlays
   * This allows My Contributions panel to show unsaved/unsubmitted work alongside submitted work
   */
  const allContributions = computed<UserContribution[]>(() => {
    const user = authStore.user;

    if (!user) return [];

    // Start with backend contributions
    const backendContributions = Object.values(projectStore.userContributions);

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
          };
          contributionsMap.set(overlay.projectId, parentProject);
        }
      } else {
        // Parent project not in backend contributions
        // Check if it exists in local projects store
        const localProject = projectStore.projects[overlay.projectId];

        if (localProject && localProject.ownerId === user.id) {
          const localOverlayData = createLocalOverlayContribution(
            overlay,
            {
              countryCode: localProject.countryCode,
              countryName: localProject.countryName ?? null,
            },
            user.username ?? null,
          );
          contributionsMap.set(
            localProject.id,
            buildLocalContribution(localProject, [localOverlayData], user.username ?? null),
          );
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
            countryCode: localProject.countryCode,
            countryName: localProject.countryName ?? null,
          },
          user.username ?? null,
        ),
      );

      contributionsMap.set(
        localProject.id,
        buildLocalContribution(localProject, overlayData, user.username ?? null),
      );
    }

    // Surface staged renders (live only in stagedRenderStore until submitted) as pending render
    // entries on their parent contribution, mirroring how submitted renders appear in the list.
    for (const [projectId, contribution] of contributionsMap) {
      const stagedRender = getStagedRender(projectId);
      if (!stagedRender) continue;

      const renderId = `staged-render-${projectId}`;
      if (contribution.overlays.some((overlay) => overlay.id === renderId)) continue;

      const renderOverlay = createLocalOverlayContribution(
        {
          id: renderId,
          caption: null,
          filename: `${renderId}.webp`,
          projectId,
          authorId: user.id,
          replacesOverlayId: null,
          status: null,
          imageUrl: stagedRender.previewUrl,
        },
        {
          countryCode: contribution.countryCode,
          countryName: contribution.countryName,
        },
        user.username ?? null,
        "render",
      );

      contributionsMap.set(projectId, {
        ...contribution,
        overlays: [...contribution.overlays, renderOverlay],
      });
    }

    // Convert map back to array and sort by updated date (most recent first)
    const result = [...contributionsMap.values()].toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return result;
  });

  // eslint-disable-next-line complexity
  async function fetchUserContributions() {
    if (!authStore.user) return;

    if (projectStore.userContributionsLoaded) return;

    projectStore.setUserContributionsLoading(true);
    try {
      const result = await loadOrNull(
        async () => trpc.project.getUsersContributions.query({ limit: 50 }),
        { errorMessage: "Failed to load contributions. Please refresh the page." },
      );

      if (result) {
        projectStore.setUserContributions(result.projects);
      }
    } finally {
      projectStore.setUserContributionsLoading(false);
    }
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
      const result = await loadOrNull(
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
    fetchUserContributions,
    deleteOverlay,
    deleteProject,
    allContributions,
  };
}
