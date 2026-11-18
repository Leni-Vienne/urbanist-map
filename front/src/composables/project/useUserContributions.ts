import { useSubmissionStore } from "@/stores/submissionStore";
import { computed, ref } from "vue";
import { useProjectStore } from "@/stores/projectStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useFocusStore } from "@/stores/focusStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { t } from "@/locales";
import type { Project, ProjectPanelOverlay } from "@/types/index";

type ContributionFilter = "all" | "pending" | "reviewed";

export function useUserContributions() {
  const submissionStore = useSubmissionStore();
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

  const overlaysByProjectId = computed(groupContributionOverlays);

  function groupContributionOverlays() {
    const result: Record<string, ProjectPanelOverlay[]> = {};
    const externalProjectId = pinnedExternalProject.value?.id;
    for (const project of allContributions.value) result[project.id] = [];
    if (externalProjectId) result[externalProjectId] = [];

    const savedOverlays = contributionStore.overlaysById;
    const liveOverlays = overlayStore.liveOverlays;
    for (const overlay of Object.values(savedOverlays)) {
      if (!overlay.projectId) continue;
      const projectOverlays = result[overlay.projectId];
      if (!projectOverlays) continue;

      const live = liveOverlays[overlay.id];
      if (!live) {
        projectOverlays.push(overlay);
        continue;
      }
      projectOverlays.push({
        ...overlay,
        caption: live.caption,
        filename: live.filename,
        imageUrl: live.imageUrl.startsWith("data:") ? live.imageUrl : overlay.imageUrl,
      });
    }

    for (const overlay of Object.values(liveOverlays)) {
      if (!overlay.projectId || savedOverlays[overlay.id]) continue;
      if (overlay.status === null || overlay.projectId === externalProjectId) {
        result[overlay.projectId]?.push(overlay);
      }
    }
    return result;
  }

  const localRenderPreviewUrlsByProjectId = computed<Record<string, string>>(() => {
    const urls: Record<string, string> = {};
    const projectIds = allContributions.value.map((project) => project.id);
    if (pinnedExternalProject.value) projectIds.push(pinnedExternalProject.value.id);
    for (const projectId of projectIds) {
      const render = submissionStore.getStagedRender(projectId);
      if (render) urls[projectId] = render.previewUrl;
    }
    return urls;
  });

  function isContributionPending(project: Project): boolean {
    if (project.status === "pending" || project.status === null) return true;
    if (localRenderPreviewUrlsByProjectId.value[project.id]) return true;

    const overlays = overlaysByProjectId.value[project.id] ?? [];
    for (const overlay of overlays) {
      if (overlay.status === "pending" || overlay.status === null) return true;
    }

    for (const change of changeRequestStore.pendingChangeRequests) {
      if (change.entityType === "project" && change.entityId === project.id) return true;
      if (change.entityType !== "overlay") continue;
      for (const overlay of overlays) {
        if (overlay.id === change.entityId) return true;
      }
    }
    return false;
  }

  const pendingCount = computed(() => allContributions.value.filter(isContributionPending).length);
  const reviewedCount = computed(() => allContributions.value.length - pendingCount.value);

  const filterTabs = computed<{ key: ContributionFilter; label: string; count: number }[]>(() => [
    { key: "all", label: t("contribute.filterAll"), count: allContributions.value.length },
    { key: "pending", label: t("approvalStatus.pending"), count: pendingCount.value },
    { key: "reviewed", label: t("contribute.filterReviewed"), count: reviewedCount.value },
  ]);

  const filteredProjects = computed(() => {
    if (activeFilter.value === "all") return allContributions.value;
    const pending = activeFilter.value === "pending";
    return allContributions.value.filter((project) => isContributionPending(project) === pending);
  });

  return {
    isLoading,
    allContributions,
    overlaysByProjectId,
    localRenderPreviewUrlsByProjectId,
    pinnedExternalProject,
    activeFilter,
    filterTabs,
    filteredProjects,
  };
}
