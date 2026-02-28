<template>
  <!-- AI : Full panel for authenticated users -->
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
      <!-- AI : Edit button - navigates to project for editing -->
      <button
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-500 hover:text-primary-600 hover:bg-primary-50 hover:border-primary-200"
        @click.stop="handleEditProjectClick(project)"
        v-tooltip.top="$t('tooltips.editProject')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- AI : Add image button - same icon as in UnifiedProjectPopup -->
      <button
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-surface-600 hover:text-surface-700 hover:bg-surface-100 hover:border-surface-300"
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
      <!-- AI : Save button - uses save icon, disabled when no changes -->
      <button
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center transition-all duration-150 text-sm text-green-500"
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
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteProjectClick(project)"
        v-tooltip.top="$t('contribute.deleteProject')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #overlay-actions="{ overlay }">
      <!-- AI : Edit button - hide for replaced overlays (can't be edited) -->
      <button
        v-if="overlay.status !== 'replaced'"
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-500 hover:text-primary-600 hover:bg-primary-50 hover:border-primary-200"
        @click.stop="handleEditOverlayClick(overlay)"
        v-tooltip.top="$t('tooltips.editOverlay')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- AI : Show delete for drafts (null/undefined), pending, or rejected overlays -->
      <button
        v-if="!overlay.status || overlay.status === 'pending' || overlay.status === 'rejected'"
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteOverlayClick(overlay)"
        v-tooltip.top="$t('contribute.deleteOverlay')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        v-if="change.status === 'pending' || change.status === 'conflicted'"
        class="w-8 h-8 border border-surface-200 rounded-md bg-surface-0 flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
        @click.stop="handleDeleteChangeRequestClick(change)"
        v-tooltip.top="$t('contribute.deleteChangeRequest')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #header-actions>
      <!-- AI : Wrapper with column layout for two rows -->
      <div class="flex flex-col gap-3 w-full">
        <!-- AI : First row - breadcrumb and buttons -->
        <div class="flex gap-4 items-center justify-between w-full">
          <span class="flex items-center gap-2 text-base min-w-0 flex-1">
            <span
              :class="[
                'font-semibold shrink-0 text-surface-800',
                showingCityProjects
                  ? 'text-primary-500 cursor-pointer transition-all duration-200 py-1 px-2 rounded -my-1 -mx-2 hover:text-primary-600 hover:bg-primary-50'
                  : '',
              ]"
              @click="showingCityProjects ? handleMyContributionsClick() : null"
              :title="showingCityProjects ? $t('contribute.viewAllContributions') : ''"
            >
              {{ $t("contribute.myContributions") }}
            </span>
            <template v-if="lastSelectedCity">
              <span class="text-surface-400 font-normal mx-1 shrink-0">|</span>
              <span
                :class="[
                  'font-semibold cursor-pointer transition-all duration-200 py-1 px-2 rounded -my-1 -mx-2 overflow-hidden text-ellipsis whitespace-nowrap min-w-0',
                  cityLinkClicked
                    ? 'text-surface-900'
                    : 'text-primary-500 hover:text-primary-600 hover:bg-primary-50',
                ]"
                @click="handleCityClick()"
                :title="$t('contribute.viewCityProjects')"
              >
                {{ lastSelectedCity.name }}
              </span>
            </template>
          </span>

          <!-- AI : Buttons on the right -->
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

        <!-- AI : Second row - filters -->
        <div class="flex items-center gap-4 flex-wrap">
          <div class="flex items-center gap-2">
            <Checkbox v-model="showPending" inputId="showPending" binary />
            <label
              for="showPending"
              class="text-sm text-surface-600 cursor-pointer whitespace-nowrap"
              >{{ $t("help.filters.showPending") }}</label
            >
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="showApproved" inputId="showApproved" binary />
            <label
              for="showApproved"
              class="text-sm text-surface-600 cursor-pointer whitespace-nowrap"
              >{{ $t("help.filters.showApproved") }}</label
            >
          </div>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
import {
  smartZoomToCity,
  citiesWithProjects,
  type CityWithProjects,
} from "@/services/map/cityMarkers";
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

// AI : Type definition from tRPC backend response for change requests
type ChangeRequest = RouterOutput["changes"]["getPendingChangeRequests"][0];

const { t } = useI18n();

// AI : Use cached composable for user contributions (backend only)
const { isLoading, fetchUserContributions, allContributions } = useUserContributions();

// AI : Use deletion composable for delete operations
const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();

const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const pendingModsStore = usePendingModificationsStore();

// AI : Use submission dialog composable to trigger the singleton dialog (rendered in Home.vue)
const { prepareProjectWithOverlaysSubmission } = useSubmissionDialog();

// AI : Filter state - both true by default to show everything
const showPending = ref(true);
const showApproved = ref(true);

const { handleNewProjectClick } = useNewProject();

// AI : Handle new project button click with error feedback
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

// AI : Toast for delete operations
const toast = useToast();

// AI : Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } =
  useChangeRequests();

// AI : Watch for city and mode changes to fetch appropriate contributions
// AI : - Edit mode + city selected: ALL projects in that city (so users can contribute to any project)
// AI : - Otherwise: User's own contributions from anywhere
watch(
  () => ({ cityId: mapStore.selectedCity?.id, mode: overlayStore.mode }),
  ({ cityId, mode }) => {
    const isEditMode = mode === "edit";

    // AI : Fetch contributions with appropriate scope
    // AI : includeCityProjects=true returns ALL city projects (not just user's), allowing contributions to any project in the city
    fetchUserContributions({
      cityId: isEditMode ? cityId : undefined,
      includeCityProjects: isEditMode && Boolean(cityId),
    });
  },
  { immediate: true }, // AI : Run on mount
);

// AI : Just use allContributions directly - backend handles everything!
const displayedProjects = allContributions;

// AI : Track if we're currently showing city-scoped projects or ALL user contributions
const showingCityProjects = ref(false);
// AI : Remember the last selected city even after clearing selection
const lastSelectedCity = ref<{
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode?: string;
} | null>(null);

// AI : Update state based on city selection and mode
watch(
  () => ({ city: mapStore.selectedCity, mode: overlayStore.mode }),
  ({ city, mode }) => {
    if (mode === "edit" && city) {
      // AI : Remember this city and mark as showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      };
      showingCityProjects.value = true;
    } else if (city) {
      // AI : In view mode, remember city but not showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      };
    }
    // AI : Don't clear lastSelectedCity when city is cleared - keep it for breadcrumb
  },
  { immediate: true },
);

// AI : Handle "My Contributions" click - switch to show only user's contributions
function handleMyContributionsClick() {
  // AI : Switch to user contribution mode
  showingCityProjects.value = false;

  // AI : Clear the selected city to exit city-scoped view
  mapStore.clearSelectedCity();

  // AI : Fetch all user contributions (no city scoping)
  // AI : The cache will prevent redundant calls if we've already fetched this
  fetchUserContributions();
}

// AI : City breadcrumb clicked state - true until the user manually moves the map
const cityLinkClicked = ref(false);
let dragStartHandler: (() => void) | null = null;
let zoomStartHandler: (() => void) | null = null;

function detachCityLinkHandlers() {
  if (dragStartHandler) {
    map.value.off("dragstart", dragStartHandler);
    dragStartHandler = null;
  }
  if (zoomStartHandler) {
    map.value.off("zoomstart", zoomStartHandler);
    zoomStartHandler = null;
  }
}

onUnmounted(detachCityLinkHandlers);

// AI : Handle city name click - switch back to showing city projects and smart zoom
function handleCityClick() {
  if (!lastSelectedCity.value) return;

  // AI : Smart zoom to city if we have coordinates
  const city = citiesWithProjects.value.find(
    (c: CityWithProjects) => c.id === lastSelectedCity.value!.id,
  );
  if (city) {
    cityLinkClicked.value = true;
    detachCityLinkHandlers();

    dragStartHandler = () => {
      cityLinkClicked.value = false;
      detachCityLinkHandlers();
    };
    map.value.once("dragstart", dragStartHandler);

    map.value.once("moveend", () => {
      zoomStartHandler = () => {
        cityLinkClicked.value = false;
        zoomStartHandler = null;
        if (dragStartHandler) {
          map.value.off("dragstart", dragStartHandler);
          dragStartHandler = null;
        }
      };
      map.value.once("zoomstart", zoomStartHandler);
    });

    const overlays = mapStore.getCityOverlaysAndProjectsCache(city.id, overlayStore.mode) ?? [];
    const projects = mapStore.getCityStandaloneProjectsCache(city.id, overlayStore.mode) ?? [];
    smartZoomToCity(city, { overlays, projects });
  }

  // AI : Switch to city project mode only if not already there
  if (!showingCityProjects.value) {
    showingCityProjects.value = true;
    mapStore.setSelectedCity(lastSelectedCity.value);
    if (overlayStore.mode !== "edit") {
      overlayStore.setMode("edit");
    }
    fetchUserContributions({
      cityId: lastSelectedCity.value.id,
      includeCityProjects: true,
    });
  }
}

// AI : Computed filtered projects based on two independent checkboxes
// AI : Uses displayedProjects which conditionally shows city data or user contributions
const filteredProjects = computed(() => {
  // AI : If neither checkbox is selected, show nothing
  if (!showPending.value && !showApproved.value) {
    return [];
  }

  // AI : If both are selected, show everything
  if (showPending.value && showApproved.value) {
    return displayedProjects.value;
  }

  // AI : Filter based on which checkbox(es) are selected
  return displayedProjects.value.filter((project) => {
    // AI : Treat unsaved/unsubmitted projects (status === null) as pending
    const isPending = project.status === "pending" || project.status === null;
    const isApproved =
      project.status === "approved" ||
      project.status === "rejected" ||
      project.status === "replaced";

    // AI : Check if project has pending or unsaved overlays/changes (contributes to "pending")
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

    // AI : Show if "pending" checkbox is on and project has pending items
    if (showPending.value && hasAnyPending) {
      return true;
    }

    // AI : Show if "approved" checkbox is on and project is approved (and has no pending items)
    if (showApproved.value && isApproved && !hasAnyPending) {
      return true;
    }

    return false;
  });
});

// AI : Handle delete overlay click - uses shared deletion composable
async function handleDeleteOverlayClick(overlay: OverlayForModeration) {
  // AI : Find the project that contains this overlay
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

// AI : Check if overlay is modified using unified pendingModificationsStore
function isOverlayModified(overlayId: string): boolean {
  // AI : Check unified pending modifications store
  if (pendingModsStore.hasPendingModifications(overlayId)) {
    return true;
  }

  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) {
    // AI : Overlay not loaded in store - check edit mode cache for unsaved position changes
    const cached = overlayStore.getFromEditModeCache(overlayId);
    return cached?.isModified ?? false;
  }
  return overlayObject.isModified ?? false;
}

// AI : Handle edit overlay click - opens the shared OverlayEditor dialog via store
// AI : This uses the SAME dialog component that PopupContainer uses
function handleEditOverlayClick(overlay: OverlayForModeration) {
  // AI : Prefer the live store object so in-memory caption changes are not lost on reopen
  const liveOverlay = overlayStore.overlays[overlay.id];
  if (liveOverlay) {
    uiStore.openOverlayEditDialog(liveOverlay);
    return;
  }
  // AI : Fallback: overlay not yet loaded in store (e.g. not on map)
  // AI : Only id + caption are needed — openOverlayEditDialog accepts OverlayEditTarget
  uiStore.openOverlayEditDialog({
    id: overlay.id,
    caption: overlay.name ?? null,
  });
}

// AI : Handle add image to project - open dialog for image upload instructions
function handleAddImageToProject(project: ProjectForModeration) {
  // AI : Open the instructional dialog
  uiStore.openImageUploadDialog(project.id);
}

// AI : Check if project or any of its overlays is modified
function isProjectModified(projectId: string): boolean {
  // AI : First check if the project itself is modified (from edit form)
  const projectInStore = projectStore.projects[projectId];
  if (projectInStore?.isModified) return true;

  // AI : Check for any pending modifications in the unified store (matches infopopup logic)
  if (pendingModsStore.getModificationCountForProject(projectId) > 0) {
    return true;
  }

  // AI : Check for NEW overlays in overlayStore (status null, never submitted)
  // AI : This catches overlays that were just added but not yet moved
  const hasNewOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.projectId === projectId && overlay.status === null,
  );
  if (hasNewOverlays) return true;

  // AI : Also check all overlays for this project from displayed projects
  const project = displayedProjects.value.find((p: UserContribution) => p.id === projectId);
  if (!project?.overlays) return false;

  return project.overlays.some((overlay: UserContributionOverlay) => isOverlayModified(overlay.id));
}

// AI : Get save button tooltip based on project status and modification state
function getProjectSaveTooltip(project: ProjectForModeration): string {
  if (!isProjectModified(project.id)) {
    return t("overlay.noChangesToSave");
  }
  return t("project.submitChangeRequest");
}

// AI : Handle save project click - uses shared submission dialog composable
async function handleSaveProjectClick(project: ProjectForModeration) {
  if (!isProjectModified(project.id)) return;

  // AI : Check if project itself has changes (not just overlays)
  const projectInStore = projectStore.projects[project.id];
  const projectHasChanges = projectInStore?.isModified ?? false;

  // AI : Use composable to prepare and show submission dialog
  prepareProjectWithOverlaysSubmission(project, projectHasChanges);
}

// AI : Handle edit project click - opens project edit form
function handleEditProjectClick(project: ProjectForModeration) {
  // AI : Get the latest project data from displayedProjects (not the potentially stale passed parameter)
  const latestProjectData = displayedProjects.value.find(
    (p: UserContribution) => p.id === project.id,
  );
  const projectToEdit = latestProjectData ?? project;

  // AI : Open the project edit form via uiStore
  // AI : Use unknown as intermediate type since ProjectForModeration may not have all Project fields
  uiStore.openProjectEditForm(projectToEdit as unknown as Project);
}

// AI : Load initial data
onMounted(() => {
  // AI : Force user-only mode to show only this user's change requests, even for moderators
  refreshPendingChangeRequests(true);
});
</script>
