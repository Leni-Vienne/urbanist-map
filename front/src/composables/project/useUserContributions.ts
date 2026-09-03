import { computed, ref } from "vue";
import { useProjectStore } from "@/stores/projectStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useFocusStore } from "@/stores/focusStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { t } from "@/locales";
import { getStagedRender } from "@/services/submission/stagedRenderState";
import type { Project, ProjectPanelOverlay } from "@/types/index";

type ContributionFilter = "all" | "pending" | "approved";

export function useUserContributions() {
  const projectStore = useProjectStore();
  const contributionStore = useContributionStore();
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const focusStore = useFocusStore();
  const changeRequestStore = useChangeRequestStore();

  const isLoading = computed(() => contributionStore.loading);
  const activeFilter = ref<ContributionFilter>("all");

  const allContributions = computed<Project[]>(() => {
    const user = authStore.user;
    if (!user) return [];

    const projectIds = new Set(contributionStore.projectIds);
    for (const overlay of Object.values(overlayStore.liveOverlays)) {
      if (overlay.status === null && overlay.projectId) projectIds.add(overlay.projectId);
    }
    for (const project of Object.values(projectStore.projects)) {
      if (project.status === null && project.ownerId === user.id) projectIds.add(project.id);
    }

    const contributions: Project[] = [];
    for (const projectId of projectIds) {
      const project = projectStore.projects[projectId];
      if (project) contributions.push(project);
    }
    return contributions.toSorted(
      (first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime(),
    );
  });

  const pinnedExternalProject = computed<Project | null>(() => {
    const project = focusStore.selectedProject;
    if (!project || !contributionStore.loaded) return null;
    return allContributions.value.some((contribution) => contribution.id === project.id)
      ? null
      : project;
  });

  const overlaysById = computed<Record<string, ProjectPanelOverlay>>(() => {
    const result: Record<string, ProjectPanelOverlay> = {};
    Object.assign(result, contributionStore.overlaysById);
    const visibleProjectIds = new Set(allContributions.value.map((project) => project.id));
    if (pinnedExternalProject.value) visibleProjectIds.add(pinnedExternalProject.value.id);

    for (const overlay of Object.values(overlayStore.liveOverlays)) {
      if (
        overlay.projectId &&
        visibleProjectIds.has(overlay.projectId) &&
        (overlay.status === null || pinnedExternalProject.value?.id === overlay.projectId)
      ) {
        result[overlay.id] = overlay;
      }
    }
    return result;
  });

  const projectOverlayIds = computed<Record<string, string[]>>(() => {
    const result: Record<string, string[]> = {};
    for (const project of allContributions.value) {
      result[project.id] = [];
    }
    if (pinnedExternalProject.value) result[pinnedExternalProject.value.id] = [];

    for (const overlay of Object.values(overlaysById.value)) {
      if (!overlay.projectId) continue;
      const overlayIds = result[overlay.projectId];
      if (!overlayIds) continue;
      if (!overlayIds.includes(overlay.id)) overlayIds.push(overlay.id);
    }
    return result;
  });

  const localRenderPreviewUrlsByProjectId = computed<Record<string, string>>(() => {
    const urls: Record<string, string> = {};
    const projectIds = allContributions.value.map((project) => project.id);
    if (pinnedExternalProject.value) projectIds.push(pinnedExternalProject.value.id);
    for (const projectId of projectIds) {
      const render = getStagedRender(projectId);
      if (render) urls[projectId] = render.previewUrl;
    }
    return urls;
  });

  function isContributionPending(project: Project): boolean {
    if (project.status === "pending" || project.status === null) return true;
    if (localRenderPreviewUrlsByProjectId.value[project.id]) return true;

    const overlayIds = projectOverlayIds.value[project.id] ?? [];
    for (const overlayId of overlayIds) {
      const status = overlaysById.value[overlayId]?.status;
      if (status === "pending" || status === null) return true;
    }

    return changeRequestStore.pendingChangeRequests.some((change) => {
      if (change.entityType === "project") return change.entityId === project.id;
      return overlayIds.includes(change.entityId);
    });
  }

  const pendingCount = computed(() => allContributions.value.filter(isContributionPending).length);
  const approvedCount = computed(() => allContributions.value.length - pendingCount.value);

  const filterTabs = computed<{ key: ContributionFilter; label: string; count: number }[]>(() => [
    { key: "all", label: t("contribute.filterAll"), count: allContributions.value.length },
    { key: "pending", label: t("approvalStatus.pending"), count: pendingCount.value },
    { key: "approved", label: t("approvalStatus.approved"), count: approvedCount.value },
  ]);

  const filteredProjects = computed(() => {
    if (activeFilter.value === "all") return allContributions.value;
    const pending = activeFilter.value === "pending";
    return allContributions.value.filter((project) => isContributionPending(project) === pending);
  });

  return {
    isLoading,
    allContributions,
    overlaysById,
    projectOverlayIds,
    localRenderPreviewUrlsByProjectId,
    pinnedExternalProject,
    activeFilter,
    filterTabs,
    filteredProjects,
  };
}
