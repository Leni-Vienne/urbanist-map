import { computed, ref } from "vue";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useFocusStore } from "@/stores/focusStore";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { createLocalOverlayContribution, createStagedRenderOverlay } from "@/utils/typeFactories";
import { getStagedRender } from "@/composables/submission/stagedRenderStore";
import { deleteOverlayDirect, removeProject } from "@/services/core/entityRemoval";
import type { Project, Overlay, ContributionProject } from "@/types/index";

type ContributionFilter = "all" | "pending" | "approved";

function buildLocalContribution(
  project: Project,
  overlays: Overlay[],
  username: string | null,
): ContributionProject {
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
  const focusStore = useFocusStore();
  const { pendingChangeRequests } = useChangeRequests();
  const toast = useToast();

  const isLoading = computed(() => projectStore.userContributionsLoading);

  // Which status group of contributions to show in the accordion.
  const activeFilter = ref<ContributionFilter>("all");

  // Merged contributions combining backend data with local-only projects/overlays and staged
  // renders, so the panel shows unsaved/unsubmitted work alongside submitted work.
  // eslint-disable-next-line complexity
  const allContributions = computed<ContributionProject[]>(() => {
    const user = authStore.user;
    if (!user) return [];

    const contributionsMap = new Map<string, ContributionProject>();
    for (const contrib of Object.values(projectStore.userContributions)) {
      contributionsMap.set(contrib.id, { ...contrib, overlays: contrib.overlays });
    }

    // Overlays aren't filtered by authorId: they can be added to projects the user doesn't own, and
    // project ownership handles access control.
    const localOverlays = Object.values(overlayStore.liveOverlays).filter(
      (overlay) => overlay.status === null,
    );

    for (const overlay of localOverlays) {
      if (!overlay.projectId) continue;
      const parentProject = contributionsMap.get(overlay.projectId);
      if (parentProject) {
        if (parentProject.overlays.some((o) => o.id === overlay.id)) continue;
        const localOverlayData = createLocalOverlayContribution(
          overlay,
          { countryCode: parentProject.countryCode, countryName: parentProject.countryName },
          user.username ?? null,
        );
        contributionsMap.set(overlay.projectId, {
          ...parentProject,
          overlays: [...parentProject.overlays, localOverlayData],
        });
        continue;
      }
      const localProject = projectStore.projects[overlay.projectId];
      if (localProject && localProject.ownerId === user.id) {
        const localOverlayData = createLocalOverlayContribution(
          overlay,
          { countryCode: localProject.countryCode, countryName: localProject.countryName ?? null },
          user.username ?? null,
        );
        contributionsMap.set(
          localProject.id,
          buildLocalContribution(localProject, [localOverlayData], user.username ?? null),
        );
      }
    }

    const localProjects = Object.values(projectStore.projects).filter(
      (project) => project.status === null && project.ownerId === user.id,
    );
    for (const localProject of localProjects) {
      if (contributionsMap.has(localProject.id)) continue;
      const overlayData = localOverlays
        .filter((o) => o.projectId === localProject.id)
        .map((overlay) =>
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

    // Staged renders live only in stagedRenderStore until submitted; surface them as pending render
    // entries on their parent contribution, mirroring how submitted renders appear.
    for (const [projectId, contribution] of contributionsMap) {
      const stagedRender = getStagedRender(projectId);
      if (!stagedRender) continue;
      if (contribution.overlays.some((o) => o.id === `staged-render-${projectId}`)) continue;
      const renderOverlay = createStagedRenderOverlay(
        projectId,
        stagedRender.previewUrl,
        { countryCode: contribution.countryCode, countryName: contribution.countryName },
        user.username ?? null,
        user.id,
      );
      contributionsMap.set(projectId, {
        ...contribution,
        overlays: [...contribution.overlays, renderOverlay],
      });
    }

    return [...contributionsMap.values()].toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  // If the selected project is not in the user's contributions, expose it as an external pinned
  // project so the panel can show it at top as a read-only context card.
  const pinnedExternalProject = computed<Project | null>(() => {
    const project = focusStore.selectedProject;
    if (!project) return null;
    // Own vs external can only be told apart once the user's contributions have loaded: the object
    // selected from the map carries no ownerId to shortcut the check. Until the list is loaded,
    // render nothing rather than guessing, otherwise an own project flashes as an external card and
    // then jumps into the accordion when the list arrives.
    if (!projectStore.userContributionsLoaded) return null;
    if (allContributions.value.some((p) => p.id === project.id)) return null;
    const parentCountry = { countryCode: project.countryCode, countryName: project.countryName };
    const overlays = Object.values(overlayStore.liveOverlays)
      .filter((o) => o.projectId === project.id)
      .map((o) =>
        createLocalOverlayContribution(
          {
            id: o.id,
            caption: o.caption,
            filename: o.filename,
            projectId: o.projectId,
            authorId: o.authorId,
            replacesOverlayId: o.replacesOverlayId,
            replacedByOverlayId: o.replacedByOverlayId,
            status: o.status,
            version: o.version,
            updatedAt: o.updatedAt,
            imageUrl: o.imageUrl,
          },
          parentCountry,
          authStore.user?.username ?? null,
        ),
      );
    // Renders live only in stagedRenderStore (not overlayStore), so surface a staged render here
    // as a pending render entry until it is submitted.
    const stagedRender = getStagedRender(project.id);
    if (stagedRender) {
      overlays.push(
        createStagedRenderOverlay(
          project.id,
          stagedRender.previewUrl,
          parentCountry,
          authStore.user?.username ?? null,
          authStore.user?.id ?? null,
        ),
      );
    }
    return { ...project, overlays };
  });

  // A contribution counts as "pending" when its own status is unresolved, or any of its overlays
  // or change requests are still awaiting moderation. Everything else is "approved" (resolved).
  function isContributionPending(project: Project): boolean {
    const isPending = project.status === "pending" || project.status === null;

    const hasPendingOverlays =
      project.overlays?.some(
        (overlay) => overlay.status === "pending" || overlay.status === null,
      ) ?? false;
    const hasPendingChanges = pendingChangeRequests.value.some((change) => {
      if (change.entityType === "project" && change.entityId === project.id) return true;
      return (
        project.overlays?.some(
          (overlay) => change.entityType === "overlay" && change.entityId === overlay.id,
        ) ?? false
      );
    });

    return isPending || hasPendingOverlays || hasPendingChanges;
  }

  const pendingCount = computed(
    () => allContributions.value.filter((project) => isContributionPending(project)).length,
  );
  const approvedCount = computed(() => allContributions.value.length - pendingCount.value);

  const filterTabs = computed<{ key: ContributionFilter; label: string; count: number }[]>(() => [
    { key: "all", label: t("contribute.filterAll"), count: allContributions.value.length },
    { key: "pending", label: t("approvalStatus.pending"), count: pendingCount.value },
    { key: "approved", label: t("approvalStatus.approved"), count: approvedCount.value },
  ]);

  const filteredProjects = computed(() => {
    if (activeFilter.value === "all") return allContributions.value;
    if (activeFilter.value === "pending") {
      return allContributions.value.filter((project) => isContributionPending(project));
    }
    return allContributions.value.filter((project) => !isContributionPending(project));
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
    pinnedExternalProject,
    activeFilter,
    filterTabs,
    filteredProjects,
  };
}
