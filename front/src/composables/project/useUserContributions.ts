import { computed, ref } from "vue";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useFocusStore } from "@/stores/focusStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { t } from "@/locales";
import { createLocalOverlayContribution, createStagedRenderOverlay } from "@/utils/typeFactories";
import { getStagedRender } from "@/services/submission/stagedRenderState";
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
    countryName: project.countryName ?? null,
    ownerUsername: username,
  };
}

export function useUserContributions() {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const focusStore = useFocusStore();
  const changeRequestStore = useChangeRequestStore();

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
    for (const [projectId, overlays] of Object.entries(projectStore.userContributionOverlays)) {
      const project = projectStore.projects[projectId];
      if (!project) continue;
      contributionsMap.set(projectId, {
        ...project,
        overlays,
      });
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
      contributionsMap.set(
        localProject.id,
        buildLocalContribution(localProject, [], user.username ?? null),
      );
    }

    // Staged renders live only in stagedRenderState until submitted; surface them as pending render
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
  const pinnedExternalProject = computed<ContributionProject | null>(() => {
    const project = focusStore.selectedProject;
    if (!project) return null;
    // Own vs external can only be told apart once the user's contributions have loaded: the object
    // selected from the map carries no ownerId to shortcut the check. Until the list is loaded,
    // render nothing rather than guessing, otherwise an own project flashes as an external card and
    // then jumps into the accordion when the list arrives.
    if (!projectStore.userContributionsLoaded) return null;
    if (allContributions.value.some((p) => p.id === project.id)) return null;
    const parentCountry = { countryCode: project.countryCode, countryName: project.countryName };
    // These overlays are rendered map overlays of a project the user does not own; their author is
    // unknown here, so leave authorUsername null rather than attributing them to the current user.
    const overlays = Object.values(overlayStore.liveOverlays)
      .filter((o) => o.projectId === project.id)
      .map((o) => createLocalOverlayContribution(o, parentCountry, null));
    // Renders live only in stagedRenderState (not overlayStore), so surface a staged render here
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
  function isContributionPending(project: ContributionProject): boolean {
    if (project.status === "pending" || project.status === null) return true;

    const hasPendingOverlays = project.overlays.some(
      (overlay) => overlay.status === "pending" || overlay.status === null,
    );
    if (hasPendingOverlays) return true;

    return changeRequestStore.pendingChangeRequests.some((change) => {
      if (change.entityType === "project" && change.entityId === project.id) return true;
      return project.overlays.some(
        (overlay) => change.entityType === "overlay" && change.entityId === overlay.id,
      );
    });
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

  async function fetchUserContributions(): Promise<void> {
    const userId = authStore.user?.id;
    if (!userId) return;
    if (projectStore.userContributionsLoaded || projectStore.userContributionsLoading) return;

    const epoch = authStore.getSessionEpoch();
    projectStore.setUserContributionsLoading(true);
    try {
      const result = await loadOrNull(async () => trpc.project.getUsersContributions.query(), {
        errorMessage: t("contribute.loadContributionsError"),
      });

      if (result && epoch === authStore.getSessionEpoch() && authStore.user?.id === userId) {
        projectStore.setUserContributions(result.projects);
      }
    } finally {
      if (epoch === authStore.getSessionEpoch() && authStore.user?.id === userId) {
        projectStore.setUserContributionsLoading(false);
      }
    }
  }

  return {
    isLoading,
    fetchUserContributions,
    allContributions,
    pinnedExternalProject,
    activeFilter,
    filterTabs,
    filteredProjects,
  };
}
