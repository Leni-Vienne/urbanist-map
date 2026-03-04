<template>
  <!-- Full panel for authenticated users -->
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="pendingChangeRequests"
    :show-edit-buttons="true"
    :should-switch-to-edit-mode="false"
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
      <!-- Edit button - navigates to project for editing -->
      <button
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-primary-200"
        @click.stop="handleEditProjectClick(project)"
        v-tooltip.top="$t('tooltips.editProject')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- Add image button - same icon as in UnifiedProjectPopup -->
      <button
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-(--p-text-color-secondary) hover:text-color hover:bg-content-hover-background hover:border-surface"
        @click.stop="handleAddImageToProject(project)"
        v-tooltip.top="$t('project.addImages')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M16 5h6" />
          <path d="M19 2v6" />
          <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          <circle cx="9" cy="9" r="2" />
        </svg>
      </button>
      <!-- Save button - uses save icon, disabled when no changes -->
      <button
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center transition-all duration-150 text-sm text-green-500"
        :class="
          isProjectModified(project.id)
            ? 'cursor-pointer hover:text-green-600 hover:bg-green-50 hover:border-green-200'
            : 'opacity-40 cursor-not-allowed pointer-events-none'
        "
        :disabled="!isProjectModified(project.id)"
        @click.stop="handleSaveProjectClick(project)"
        v-tooltip.top="getProjectSaveTooltip(project)"
      >
        <i class="pi pi-send"></i>
      </button>
      <button
        v-if="!project.status || project.status === 'pending' || project.status === 'rejected'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteProjectClick(project)"
        v-tooltip.top="$t('contribute.deleteProject')"
      >
        <i class="pi pi-trash"></i>
      </button>
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

    <template #empty-state>
      <p
        v-if="displayedProjects.length === 0"
        class="text-sm text-muted-color mt-3 max-w-65 leading-relaxed"
      >
        {{ $t("contribute.guest.description") }}
      </p>
    </template>

    <template #header-actions>
      <!-- Wrapper with column layout for two rows -->
      <div class="flex flex-col gap-3 w-full">
        <!-- First row - breadcrumb and buttons -->
        <div class="flex gap-4 items-center justify-between w-full">
          <span class="flex items-center gap-2 text-base min-w-0 flex-1">
            <span
              :class="[
                'font-semibold shrink-0 transition-all duration-200 py-1 px-2 rounded -my-1 -mx-2',
                showingCityProjects
                  ? 'text-primary-color cursor-pointer hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)]'
                  : 'text-color',
              ]"
              @click="showingCityProjects ? handleMyContributionsClick() : null"
              :title="showingCityProjects ? $t('contribute.viewAllContributions') : ''"
            >
              {{ $t("contribute.myContributions") }}
            </span>
            <template v-if="showingCityProjects && lastSelectedCity">
              <span class="text-muted-color font-normal mx-1 shrink-0">|</span>
              <span
                class="font-semibold text-color py-1 px-2 rounded -my-1 -mx-2 overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
              >
                {{ lastSelectedCity.name }}
              </span>
            </template>
          </span>

          <!-- Buttons on the right -->
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
              >{{ $t("help.filters.showPending") }}</label
            >
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="showApproved" inputId="showApproved" binary />
            <label
              for="showApproved"
              class="text-sm text-(--p-text-color-secondary) cursor-pointer whitespace-nowrap"
              >{{ $t("help.filters.showApproved") }}</label
            >
          </div>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import type { RouterOutput } from "@/client";
import type {
  ProjectForModeration,
  OverlayForModeration,
  Project,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";

import ProjectAccordionPanel from "@/components/layout/ProjectAccordionPanel.vue";

// Type definition from tRPC backend response for change requests
type ChangeRequest = RouterOutput["changes"]["getPendingChangeRequests"][0];

const { t } = useI18n();

// Use cached composable for user contributions (backend only)
const { isLoading, fetchUserContributions, allContributions } = useUserContributions();

// Use deletion composable for delete operations
const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();

const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const pendingModsStore = usePendingModificationsStore();

// Use submission dialog composable to trigger the singleton dialog (rendered in Home.vue)
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

// Toast for delete operations
const toast = useToast();

// Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } =
  useChangeRequests();

// Watch for city and mode changes to fetch appropriate contributions
// - Edit mode + city selected: ALL projects in that city (so users can contribute to any project)
// - Otherwise: User's own contributions from anywhere
watch(
  () => ({ cityId: mapStore.selectedCity?.id, mode: overlayStore.mode }),
  ({ cityId, mode }) => {
    const isEditMode = mode === "edit";

    // Fetch contributions with appropriate scope
    // includeCityProjects=true returns ALL city projects (not just user's), allowing contributions to any project in the city
    fetchUserContributions({
      cityId: isEditMode ? cityId : undefined,
      includeCityProjects: isEditMode && Boolean(cityId),
    });
  },
  { immediate: true }, // Run on mount
);

// Just use allContributions directly - backend handles everything!
const displayedProjects = allContributions;

// Track if we're currently showing city-scoped projects or ALL user contributions
const showingCityProjects = ref(false);
// Remember the last selected city even after clearing selection
const lastSelectedCity = ref<{
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode?: string;
} | null>(null);

// Update state based on city selection and mode
watch(
  () => ({ city: mapStore.selectedCity, mode: overlayStore.mode }),
  ({ city, mode }) => {
    if (mode === "edit" && city) {
      // Remember this city and mark as showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      };
      showingCityProjects.value = true;
    } else if (city) {
      // In view mode, remember city but not showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      };
    }
    // Don't clear lastSelectedCity when city is cleared - keep it for breadcrumb
  },
  { immediate: true },
);

// Handle "My Contributions" click - switch to show only user's contributions
function handleMyContributionsClick() {
  // Switch to user contribution mode
  showingCityProjects.value = false;

  // Clear the selected city to exit city-scoped view
  mapStore.clearSelectedCity();

  // Fetch all user contributions (no city scoping)
  // The cache will prevent redundant calls if we've already fetched this
  fetchUserContributions();
}

// Computed filtered projects based on two independent checkboxes
// Uses displayedProjects which conditionally shows city data or user contributions
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
  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.name);
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

// Check if overlay is modified using unified pendingModificationsStore
function isOverlayModified(overlayId: string): boolean {
  // Check unified pending modifications store
  if (pendingModsStore.hasPendingModifications(overlayId)) {
    return true;
  }

  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) {
    // Overlay not loaded in store - check edit mode cache for unsaved position changes
    const cached = overlayStore.getFromEditModeCache(overlayId);
    return cached?.isModified ?? false;
  }
  return overlayObject.isModified ?? false;
}

// Handle edit overlay click - opens the shared OverlayEditor dialog via store
// This uses the SAME dialog component that PopupContainer uses
function handleEditOverlayClick(overlay: OverlayForModeration) {
  // Prefer the live store object so in-memory caption changes are not lost on reopen
  const liveOverlay = overlayStore.overlays[overlay.id];
  if (liveOverlay) {
    uiStore.openOverlayEditDialog(liveOverlay);
    return;
  }
  // Fallback: overlay not yet loaded in store (e.g. not on map)
  // Only id + caption are needed — openOverlayEditDialog accepts OverlayEditTarget
  uiStore.openOverlayEditDialog({
    id: overlay.id,
    caption: overlay.name ?? null,
  });
}

// Handle add image to project - open dialog for image upload instructions
function handleAddImageToProject(project: ProjectForModeration) {
  // Open the instructional dialog
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

// Get save button tooltip based on project status and modification state
function getProjectSaveTooltip(project: ProjectForModeration): string {
  if (!isProjectModified(project.id)) {
    return t("overlay.noChangesToSave");
  }
  return t("project.submitChangeRequest");
}

// Handle save project click - uses shared submission dialog composable
async function handleSaveProjectClick(project: ProjectForModeration) {
  if (!isProjectModified(project.id)) return;

  // Check if project itself has changes (not just overlays)
  const projectInStore = projectStore.projects[project.id];
  const projectHasChanges = projectInStore?.isModified ?? false;

  // Use composable to prepare and show submission dialog
  prepareProjectWithOverlaysSubmission(project, projectHasChanges);
}

// Handle edit project click - opens project edit form
function handleEditProjectClick(project: ProjectForModeration) {
  // Get the latest project data from displayedProjects (not the potentially stale passed parameter)
  const latestProjectData = displayedProjects.value.find(
    (p: UserContribution) => p.id === project.id,
  );
  const projectToEdit = latestProjectData ?? project;

  // Open the project edit form via uiStore
  // Use unknown as intermediate type since ProjectForModeration may not have all Project fields
  uiStore.openProjectEditForm(projectToEdit as unknown as Project);
}

// Load initial data
onMounted(() => {
  // Force user-only mode to show only this user's change requests, even for moderators
  refreshPendingChangeRequests(true);
});
</script>
