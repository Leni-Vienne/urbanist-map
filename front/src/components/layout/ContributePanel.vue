<template>
  <!-- Full panel for authenticated users -->
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="pendingChangeRequests"
    :show-edit-buttons="true"
    :should-switch-to-edit-mode="false"
    :pinned-project-id="selectedProjectId"
    :pinned-external-project="pinnedExternalProject"
    @external-project-click="handleExternalProjectClick"
    title=""
    panel-class="my-contributions-panel"
    :empty-message="
      displayedProjects.length > 0 && filteredProjects.length === 0
        ? $t('contribute.noProjectsMatchFilter')
        : $t('contribute.noProjectsFound')
    "
    :empty-sub-message="
      displayedProjects.length > 0 && filteredProjects.length === 0
        ? $t('contribute.tryChangingFilters')
        : $t('contribute.createFirstProject')
    "
  >
    <template #project-actions="{ project }">
      <ProjectActionButtons
        :project="project"
        show-edit
        show-add-image
        show-draw
        show-save
        show-delete
        :is-modified="isProjectModified(project.id)"
        @edit="handleEditProjectClick"
        @add-image="handleAddImageToProject"
        @draw="handleDrawShapesClick"
        @save="handleSaveProjectClick"
        @delete="handleDeleteProjectClick"
      />
    </template>

    <template #overlay-actions="{ overlay }">
      <!-- Edit button - hide for replaced overlays (can't be edited) -->
      <button
        v-if="overlay.status !== 'replaced'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-primary-200"
        @click.stop="handleEditOverlayClick(overlay)"
        v-tooltip.top="$t('tooltips.editOverlay')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- Show delete for drafts (null/undefined), pending, or rejected overlays -->
      <button
        v-if="!overlay.status || overlay.status === 'pending' || overlay.status === 'rejected'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteOverlayClick(overlay)"
        v-tooltip.top="$t('contribute.deleteOverlay')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        v-if="change.status === 'pending' || change.status === 'conflicted'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteChangeRequestClick(change)"
        v-tooltip.top="$t('contribute.deleteChangeRequest')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #pinned-external-project-actions="{ project }">
      <!-- For external (non-owned) selected projects: add image + submit only -->
      <ProjectActionButtons
        :project="project"
        show-add-image
        show-save
        :is-modified="isProjectModified(project.id)"
        @add-image="handleAddImageToProject"
        @save="handleSaveProjectClick"
      />
    </template>

    <template #empty-state>
      <p
        v-if="displayedProjects.length === 0"
        class="text-sm text-muted-color mt-3 max-w-65 leading-relaxed"
      >
        {{ $t("contribute.guest.description") }}
      </p>
    </template>

    <template #header-actions>
      <div class="flex gap-4 items-center justify-between w-full">
        <div class="flex flex-col gap-3 w-full">
          <!-- First row - title and buttons -->
          <div class="flex gap-4 items-center justify-between w-full">
            <span class="text-base font-semibold text-color">
              {{ $t("contribute.myContributions") }}
            </span>
            <div class="flex gap-2">
              <Button
                @click="handleAddOverlayClick"
                severity="primary"
                size="small"
                icon="pi pi-plus"
                :label="$t('common.add')"
                class="font-semibold"
                v-tooltip.bottom="$t('dialog.createNewProject')"
              />
            </div>
          </div>
          <!-- Second row - filters (hidden when no contributions yet) -->
          <div v-if="displayedProjects.length > 0" class="flex items-center gap-4 flex-wrap">
            <div class="flex items-center gap-2">
              <Checkbox v-model="showPending" inputId="showPending" binary />
              <label
                for="showPending"
                class="text-sm text-(--p-text-color-secondary) cursor-pointer whitespace-nowrap"
              >
                {{ $t("help.filters.showPending") }}
              </label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox v-model="showApproved" inputId="showApproved" binary />
              <label
                for="showApproved"
                class="text-sm text-(--p-text-color-secondary) cursor-pointer whitespace-nowrap"
              >
                {{ $t("help.filters.showApproved") }}
              </label>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { expandAccordionForProject, activeAccordionPanels } from "@/services/layout/accordionState";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { map } from "@/services/core/map";
import L from "leaflet";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { resolveShapeEditorGeometry } from "@/services/shape/shapeEditorGeometry";
import {
  closeProjectPopupAndResetMarkers,
  handleShapeProjectClick,
} from "@/services/map/standaloneProjectMarkers";
import type { RouterOutput } from "@/client";
import type {
  Project,
  ProjectForModeration,
  UserContribution,
  UserContributionOverlay,
  OverlayForModeration,
} from "@/types/index";
import {
  createOverlayForModeration,
  createProjectForModerationFromProject,
} from "@/utils/projectFactories";

import ProjectAccordionPanel from "@/components/layout/ProjectAccordionPanel.vue";
import ProjectActionButtons from "@/components/project/ProjectActionButtons.vue";

// Type definition from tRPC backend response for change requests
type ChangeRequest = RouterOutput["changes"]["getPendingChangeRequests"][0];

const { t } = useI18n();

const { isLoading, fetchUserContributions, allContributions } = useUserContributions();

const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();

const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const pendingModsStore = usePendingModificationsStore();

const { prepareProjectWithOverlaysSubmission } = useSubmissionDialog();

// Filter state - both true by default to show everything
const showPending = ref(true);
const showApproved = ref(true);

const { handleNewProjectClick } = useNewProject();

// Handle new project button click with error feedback
async function handleAddOverlayClick() {
  const result = await handleNewProjectClick();
  if (!result.success && result.reason === "edit_mode_error") {
    toast.add({
      severity: "error",
      summary: t("moderation.modeSwitchError"),
      detail: t("moderation.modeSwitchErrorDetail"),
      life: 3000,
    });
  }
}

const toast = useToast();
const { isMobile } = useIsMobile();

const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } =
  useChangeRequests();

// Just use allContributions directly - backend handles everything
const displayedProjects = allContributions;

// Persists the last selected project so the card stays in ContributePanel even after the popup closes.
// Only updates when a new project is opened, never clears on close.
const lastSelectedProject = ref<Project | null>(null);

// Update when a standalone project popup opens (shape / vector footprint click)
watch(
  () => uiStore.projectInfoPopup.project,
  (project) => {
    if (project && "overlayIds" in project) lastSelectedProject.value = project;
  },
  { immediate: true },
);

// Update when an overlay image or marker is clicked (selectOverlay closes projectInfoPopup,
// so we read the project from the overlay object directly instead)
watch(
  () => overlayStore.idSelectedOverlay,
  (overlayId) => {
    if (!overlayId) return;
    const overlay = overlayStore.overlays[overlayId];
    const project = overlay?.project;
    if (project) lastSelectedProject.value = project as unknown as Project;
  },
  { immediate: true },
);

const selectedProjectId = computed(() => lastSelectedProject.value?.id ?? null);

// If the selected project is not in the user's contributions, expose it as an external pinned project
// so ContributePanel can show it at top as a read-only context card
const pinnedExternalProject = computed<ProjectForModeration | null>(() => {
  const id = selectedProjectId.value;
  if (!id) return null;
  // If it's already in contributions, it will be pinned via pinnedProjectId instead
  const isOwnContribution = displayedProjects.value.some((p) => p.id === id);

  if (isOwnContribution) return null;
  const project = lastSelectedProject.value;
  if (!project) return null;
  const overlays = Object.values(overlayStore.overlays)
    .filter((o) => o.projectId === project.id)
    .map((o) => createOverlayForModeration(o));
  return createProjectForModerationFromProject(project, overlays);
});

const filteredProjects = computed(() => {
  // If neither checkbox is selected, show nothing
  if (!showPending.value && !showApproved.value) {
    return [];
  }

  // If both are selected, show everything
  if (showPending.value && showApproved.value) {
    return displayedProjects.value;
  }

  // Filter based on which checkbox(es) are selected
  return displayedProjects.value.filter((project) => {
    // Treat unsaved/unsubmitted projects (status === null) as pending
    const isPending = project.status === "pending" || project.status === null;
    const isApproved =
      project.status === "approved" ||
      project.status === "rejected" ||
      project.status === "replaced";

    // Check if project has pending or unsaved overlays/changes (contributes to "pending")
    const hasPendingOverlays =
      project.overlays?.some(
        (overlay: UserContributionOverlay) =>
          overlay.status === "pending" || overlay.status === null,
      ) ?? false;
    const hasPendingChanges = pendingChangeRequests.value.some((change) => {
      if (change.entityType === "project" && change.entityId === project.id) {
        return true;
      }
      return (
        project.overlays?.some(
          (overlay: UserContributionOverlay) =>
            change.entityType === "overlay" && change.entityId === overlay.id,
        ) ?? false
      );
    });

    const hasAnyPending = isPending || hasPendingOverlays || hasPendingChanges;

    // Show if "pending" checkbox is on and project has pending items
    if (showPending.value && hasAnyPending) {
      return true;
    }

    // Show if "approved" checkbox is on and project is approved (and has no pending items)
    if (showApproved.value && isApproved && !hasAnyPending) {
      return true;
    }

    return false;
  });
});

// Handle delete overlay click - uses shared deletion composable
async function handleDeleteOverlayClick(overlay: OverlayForModeration) {
  // Find the project that contains this overlay
  const project = displayedProjects.value.find((displayedProject: UserContribution) =>
    displayedProject.overlays?.some(
      (overlayElement: UserContributionOverlay) => overlayElement.id === overlay.id,
    ),
  );

  const overlayCount = project?.overlays?.length ?? 0;
  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.caption);
}

async function handleDeleteProjectClick(project: ProjectForModeration) {
  await deleteProjectWithConfirm(project.id, project.name, project.overlays?.length ?? 0);
}

async function handleDeleteChangeRequestClick(change: ChangeRequest) {
  const fieldName = change.fieldName;
  const confirmed = confirm(t("contribute.confirmDeleteChangeRequest", { field: fieldName }));
  if (!confirmed) return;

  const result = await deleteChangeRequest(change.id);
  if (result) {
    toast.add({
      severity: "success",
      summary: t("contribute.changeRequestDeleted"),
      life: 3000,
    });
  }
}

function isOverlayModified(overlayId: string): boolean {
  if (pendingModsStore.hasPendingModifications(overlayId)) {
    return true;
  }

  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) {
    const cached = overlayStore.getFromEditModeCache(overlayId);
    return cached?.isModified ?? false;
  }
  return overlayObject.isModified ?? false;
}

function handleEditOverlayClick(overlay: OverlayForModeration) {
  // Prefer the live store object so in-memory caption changes are not lost on reopen
  const liveOverlay = overlayStore.overlays[overlay.id];
  if (liveOverlay) {
    uiStore.openOverlayEditDialog(liveOverlay);
    return;
  }
  // Fallback: overlay not yet loaded in store (e.g. not on map)
  // Only id + caption are needed, openOverlayEditDialog accepts OverlayEditTarget
  uiStore.openOverlayEditDialog({
    id: overlay.id,
    caption: overlay.caption,
  });
}

function handleAddImageToProject(project: ProjectForModeration) {
  uiStore.openImageUploadDialog(project.id);
}

// Check if project or any of its overlays is modified
function isProjectModified(projectId: string): boolean {
  // First check if the project itself is modified (from edit form)
  const projectInStore = projectStore.projects[projectId];
  if (projectInStore?.isModified) return true;

  // Check for any pending modifications in the unified store (matches infopopup logic)
  if (pendingModsStore.getModificationCountForProject(projectId) > 0) {
    return true;
  }

  // Check for NEW overlays in overlayStore (status null, never submitted)
  // This catches overlays that were just added but not yet moved
  const hasNewOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.projectId === projectId && overlay.status === null,
  );
  if (hasNewOverlays) return true;

  // Also check all overlays for this project from displayed projects
  const project = displayedProjects.value.find((p: UserContribution) => p.id === projectId);
  if (!project?.overlays) return false;

  return project.overlays.some((overlay: UserContributionOverlay) => isOverlayModified(overlay.id));
}

async function handleSaveProjectClick(project: ProjectForModeration) {
  if (!isProjectModified(project.id)) return;

  // Check if project itself has changes (not just overlays)
  const projectInStore = projectStore.projects[project.id];
  const projectHasChanges = projectInStore?.isModified ?? false;

  // Use composable to prepare and show submission dialog
  prepareProjectWithOverlaysSubmission(project, projectHasChanges);
}

// Handle draw shapes click, mirrors handleDrawShapes in PopupContainer
async function handleDrawShapesClick(project: ProjectForModeration) {
  if (isMobile.value) {
    toast.add({
      severity: "warn",
      summary: t("shapes.desktopOnly"),
      life: 3000,
    });
    return;
  }

  const fallbackGeometry = project.geometry ?? null;
  const existingGeometry = await resolveShapeEditorGeometry(project.id, fallbackGeometry);

  // Close any open popups (overlay popup or standalone project popup) to ensure a clean slate
  if (overlayStore.showInfoPopup) {
    overlayStore.hideInfoPopup();
  }
  if (uiStore.projectInfoPopup.visible) {
    uiStore.closeProjectInfoPopup();
    try {
      closeProjectPopupAndResetMarkers();
    } catch (error) {
      console.warn("Failed to reset standalone markers on draw popup clear", error);
    }
  }

  // Open the shape editor panel (no popup to reopen at)
  uiStore.openShapeEditor(project as unknown as Project);
  // Lazy-load geoman and initialise the toolbar with the best available geometry
  const { initShapeEditor } = await import("@/services/shape/shapeEditing");
  await initShapeEditor(map.value, existingGeometry ?? undefined);
}

// Navigate to the external pinned project using the same logic as a map click.
// The ProjectForModeration argument is intentionally ignored: it lacks geometry data.
// lastSelectedProject holds the full Project with lat/lng/geometry needed for navigation.
function handleExternalProjectClick(_project: ProjectForModeration) {
  const fullProject = lastSelectedProject.value;
  if (!fullProject) return;
  handleShapeProjectClick(fullProject, L.latLng(fullProject.lat ?? 0, fullProject.lng ?? 0));
}

function handleEditProjectClick(project: ProjectForModeration) {
  // Get the latest project data from displayedProjects (not the potentially stale passed parameter)
  const latestProjectData = displayedProjects.value.find(
    (p: UserContribution) => p.id === project.id,
  );
  const projectToEdit = latestProjectData ?? project;

  // Use unknown as intermediate type since ProjectForModeration may not have all Project fields
  uiStore.openProjectEditForm(projectToEdit as unknown as Project);
}

// Auto-expand the pinned project when the selection changes
watch(
  selectedProjectId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const isOwnContribution = displayedProjects.value.some((p) => p.id === id);
    if (isOwnContribution) {
      expandAccordionForProject(id, displayedProjects.value as unknown as ProjectForModeration[]);
    } else if (!activeAccordionPanels.value.includes(id)) {
      // External pinned project: just push the id into the shared accordion state
      activeAccordionPanels.value.push(id);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchUserContributions();
  // Force user-only mode to show only this user's change requests, even for moderators
  refreshPendingChangeRequests(true);
});
</script>
