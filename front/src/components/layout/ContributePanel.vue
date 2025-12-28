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
    :empty-message="displayedProjects.length > 0 && filteredProjects.length === 0 ? $t('contribute.noProjectsMatchFilter') : $t('contribute.noProjectsFound')"
    :empty-sub-message="displayedProjects.length > 0 && filteredProjects.length === 0 ? $t('contribute.tryChangingFilters') : $t('contribute.createFirstProject')"
  >
    <template #project-actions="{ project }">
      <!-- AI : Edit button - navigates to project for editing -->
      <button
        class="action-btn edit-btn"
        @click.stop="handleEditProjectClick(project)"
        v-tooltip.top="$t('tooltips.editProject')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- AI : Add image button - same icon as in UnifiedProjectPopup -->
      <button
        class="action-btn add-image-btn"
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
        class="action-btn save-btn"
        :class="{ disabled: !isProjectModified(project.id) }"
        :disabled="!isProjectModified(project.id)"
        @click.stop="handleSaveProjectClick(project)"
        v-tooltip.top="getProjectSaveTooltip(project)"
      >
        <i class="pi pi-save"></i>
      </button>
      <button
        v-if="!project.status || project.status === 'pending' || project.status === 'rejected'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteProjectClick(project)"
        v-tooltip.top="$t('contribute.deleteProject')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #overlay-actions="{ overlay }">
      <!-- AI : Edit button - opens overlay editor for individual overlay editing -->
      <button
        class="action-btn edit-btn"
        @click.stop="handleEditOverlayClick(overlay)"
        v-tooltip.top="$t('tooltips.editOverlay')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <button
        v-if="overlay.status === 'pending' || overlay.status === 'rejected'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteOverlayClick(overlay)"
        v-tooltip.top="$t('contribute.deleteOverlay')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        v-if="change.status === 'pending' || change.status === 'conflicted'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteChangeRequestClick(change)"
        v-tooltip.top="$t('contribute.deleteChangeRequest')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #header-actions>
      <!-- AI : Wrapper with column layout for two rows -->
      <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
        <!-- AI : First row - breadcrumb and buttons -->
        <div class="header-actions-container">
          <span class="city-header">
            <span
              :class="['panel-name', { clickable: showingCityProjects }]"
              @click="showingCityProjects ? handleMyContributionsClick() : null"
              :title="showingCityProjects ? $t('contribute.viewAllContributions') : ''"
            >
              {{ $t('contribute.myContributions') }}
            </span>
            <template v-if="lastSelectedCity">
              <span class="separator">|</span>
              <span
                :class="['city-name', { clickable: !showingCityProjects }]"
                @click="!showingCityProjects ? handleCityClick() : null"
                :title="!showingCityProjects ? $t('contribute.viewCityProjects') : ''"
              >
                {{ lastSelectedCity.name }}
              </span>
            </template>
          </span>

          <!-- AI : Buttons on the right -->
          <div style="display: flex; gap: 0.5rem;">
            <Button
              v-if="hasUnacknowledgedItems"
              @click="uiStore.openModeratedContributionsDialog()"
              :label="$t('moderation.moderatedContributions.viewResults')"
              severity="secondary"
              size="small"
              outlined
            >
              <template #icon>
                <Badge :value="moderatedContributionsCount" severity="danger" class="mr-2" />
                <i class="pi pi-bell"></i>
              </template>
            </Button>

            <Button
              @click="handleAddOverlayClick"
              severity="primary"
              size="small"
              icon="pi pi-plus"
              :label="$t('common.add')"
              class="add-project-button"
              v-tooltip.bottom="$t('dialog.createNewProject')"
            />
          </div>
        </div>

        <!-- AI : Second row - filters -->
        <div class="header-filters-row">
          <div class="field-checkbox">
            <Checkbox v-model="showPending" inputId="showPending" binary />
            <label for="showPending">{{ $t('help.filters.showPending') }}</label>
          </div>
          <div class="field-checkbox">
            <Checkbox v-model="showApproved" inputId="showApproved" binary />
            <label for="showApproved">{{ $t('help.filters.showApproved') }}</label>
          </div>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>

  <!-- AI : Submission Confirmation Dialog for publishing projects -->
  <SubmissionConfirmationDialog
    v-model:visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAddOverlay } from '@/composables/overlay/useAddOverlay'
import { useToast } from '@/composables/ui/useToast'
import { useChangeRequests } from '@/composables/changes/useChanges'
import { useUserContributions, type UserContribution, type UserContributionOverlay } from '@/composables/project/useUserContributions'
import { useModeratedContributions } from '@/composables/moderation/useModeratedContributions'
import { useUiStore } from '@/stores/uiStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { useMapStore } from '@/stores/pinia/mapStore'
import { usePendingModificationsStore } from '@/stores/pinia/pendingModificationsStore'
import { useProjectDeletion } from '@/composables/project/useProjectDeletion'
import { useSubmissionDialog } from '@/composables/submission/useSubmissionDialog'
import { useAuthStore } from '@/stores/authStore'
import type { RouterOutput } from '@/client'
import type { ProjectForModeration, OverlayForModeration, OverlayObject, Project } from '@/types/index'

import ProjectAccordionPanel from './ProjectAccordionPanel.vue'

// AI : Async component import for submission dialog
const SubmissionConfirmationDialog = defineAsyncComponent(() => import('@/components/submission/SubmissionConfirmationDialog.vue'))

// AI : Type definition from tRPC backend response for change requests
type ChangeRequest = RouterOutput['changes']['getPendingChangeRequests'][0]

const { t } = useI18n()

// AI : Use cached composable for user contributions (backend only)
const { isLoading, fetchUserContributions, allContributions } = useUserContributions()

// AI : Use deletion composable for delete operations
const { handleDeleteOverlay: deleteOverlayWithMarker, handleDeleteProject: deleteProjectWithConfirm } = useProjectDeletion()

const { moderatedContributions, hasUnacknowledgedItems } = useModeratedContributions()
const uiStore = useUiStore()
const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()
const authStore = useAuthStore()
const pendingModsStore = usePendingModificationsStore()
const moderatedContributionsCount = computed(() => moderatedContributions.value.length)

// AI : Use submission dialog composable for all submission-related state and handlers
const {
  showSubmissionDialog,
  submissionSummary,
  isSubmitting,
  prepareProjectWithOverlaysSubmission,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} = useSubmissionDialog()

// AI : Filter state - both true by default to show everything
const showPending = ref(true)
const showApproved = ref(true)

// AI : Use shared composable for add overlay button
const { handleAddOverlayClick } = useAddOverlay()

// AI : Toast for delete operations
const toast = useToast()

// AI : Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } = useChangeRequests()

// AI : Watch for city and mode changes to fetch appropriate contributions
// AI : - Edit mode + city selected: ALL projects in that city (so users can contribute to any project)
// AI : - Otherwise: User's own contributions from anywhere
watch(
  () => ({ cityId: mapStore.selectedCity?.id, mode: overlayStore.mode }),
  ({ cityId, mode }, oldValue) => {
    const isEditMode = mode === 'edit'

    // AI : Only reset cache if parameters actually changed (prevents duplicate calls on mount)
    const hasChanged = oldValue && (oldValue.cityId !== cityId || oldValue.mode !== mode)
    if (hasChanged) {
      projectStore.userContributionsLoaded = false
    }

    // AI : Fetch contributions with appropriate scope
    // AI : includeCityProjects=true returns ALL city projects (not just user's), allowing contributions to any project in the city
    fetchUserContributions({
      cityId: isEditMode ? cityId : undefined,
      includeCityProjects: isEditMode && Boolean(cityId),
    })
  },
  { immediate: true } // AI : Run on mount
)


// AI : Just use allContributions directly - backend handles everything!
const displayedProjects = allContributions

// AI : Track if we're currently showing city-scoped projects or ALL user contributions
const showingCityProjects = ref(false)
// AI : Remember the last selected city even after clearing selection
const lastSelectedCity = ref<{ id: number; name: string; nameLocal: string | null; countryCode?: string } | null>(null)

// AI : Update state based on city selection and mode
watch(
  () => ({ city: mapStore.selectedCity, mode: overlayStore.mode }),
  ({ city, mode }) => {
    if (mode === 'edit' && city) {
      // AI : Remember this city and mark as showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode
      }
      showingCityProjects.value = true
    } else if (city) {
      // AI : In view mode, remember city but not showing city projects
      lastSelectedCity.value = {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode
      }
    }
    // AI : Don't clear lastSelectedCity when city is cleared - keep it for breadcrumb
  },
  { immediate: true }
)

// AI : Handle "My Contributions" click - switch to show only user's contributions
function handleMyContributionsClick() {
  // AI : Switch to user contribution mode
  showingCityProjects.value = false

  // AI : Clear the selected city to exit city-scoped view
  mapStore.clearSelectedCity()

  // AI : Reset the cache flag to force refetch without city filter
  projectStore.userContributionsLoaded = false

  // AI : Fetch all user contributions (no city scoping)
  fetchUserContributions()
}

// AI : Handle city name click - switch back to showing city projects
function handleCityClick() {
  if (!lastSelectedCity.value) return

  // AI : Switch to city project mode
  showingCityProjects.value = true

  // AI : Re-select the city to load city projects
  mapStore.setSelectedCity(lastSelectedCity.value)

  // AI : Switch to edit mode if not already
  if (overlayStore.mode !== 'edit') {
    overlayStore.setMode('edit')
  }

  // AI : Reset cache and refetch with city filter
  projectStore.userContributionsLoaded = false
  fetchUserContributions({
    cityId: lastSelectedCity.value.id,
    includeCityProjects: true
  })
}



// AI : Computed filtered projects based on two independent checkboxes
// AI : Uses displayedProjects which conditionally shows city data or user contributions
const filteredProjects = computed(() => {
  // AI : If neither checkbox is selected, show nothing
  if (!showPending.value && !showApproved.value) {
    return []
  }

  // AI : If both are selected, show everything
  if (showPending.value && showApproved.value) {
    return displayedProjects.value
  }

  // AI : Filter based on which checkbox(es) are selected
  return displayedProjects.value.filter(project => {
    // AI : Treat unsaved/unsubmitted projects (status === null) as pending
    const isPending = project.status === 'pending' || project.status === null || project.status === undefined
    const isApproved = project.status === 'approved' || project.status === 'rejected' || project.status === 'replaced'

    // AI : Check if project has pending or unsaved overlays/changes (contributes to "pending")
    const hasPendingOverlays = project.overlays?.some((overlay: UserContributionOverlay) =>
      overlay.status === 'pending' || overlay.status === null || overlay.status === undefined
    ) ?? false
    const hasPendingChanges = pendingChangeRequests.value.some(change => {
      if (change.entityType === 'project' && change.entityId === project.id) {
        return true
      }
      return project.overlays?.some((overlay: UserContributionOverlay) =>
        change.entityType === 'overlay' && change.entityId === overlay.id
      ) ?? false
    })

    const hasAnyPending = isPending || hasPendingOverlays || hasPendingChanges

    // AI : Show if "pending" checkbox is on and project has pending items
    if (showPending.value && hasAnyPending) {
      return true
    }

    // AI : Show if "approved" checkbox is on and project is approved (and has no pending items)
    if (showApproved.value && isApproved && !hasAnyPending) {
      return true
    }

    return false
  })
})

// AI : Handle delete overlay click - uses shared deletion composable
async function handleDeleteOverlayClick(overlay: OverlayForModeration) {
  // AI : Find the project that contains this overlay
  const project = displayedProjects.value.find((project: UserContribution) =>
    project.overlays?.some((overlayElement: UserContributionOverlay) => overlayElement.id === overlay.id)
  )

  const overlayCount = project?.overlays?.length ?? 0
  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.name)
}

async function handleDeleteProjectClick(project: ProjectForModeration) {
  await deleteProjectWithConfirm(project.id, project.name, project.overlays?.length ?? 0)
}

async function handleDeleteChangeRequestClick(change: ChangeRequest) {
  const fieldName = change.fieldName
  const confirmed = confirm(t('contribute.confirmDeleteChangeRequest', { field: fieldName }))
  if (!confirmed) return

  const result = await deleteChangeRequest(change.id)
  if (result?.success) {
    toast.add({
      severity: 'success',
      summary: t('contribute.changeRequestDeleted'),
      life: 3000
    })
  }
}

// AI : Check if overlay is modified using unified pendingModificationsStore
function isOverlayModified(overlayId: string): boolean {
  // AI : Check unified pending modifications store
  if (pendingModsStore.hasPendingModifications(overlayId)) {
    return true
  }

  const overlayObject = overlayStore.overlays[overlayId]
  if (!overlayObject) {
    // AI : Overlay not loaded in store - check edit mode cache for unsaved position changes
    const cached = overlayStore.getFromEditModeCache(overlayId)
    return cached?.isModified ?? false
  }
  return overlayObject.isModified ?? false
}

// AI : Get save button tooltip based on overlay status and modification state
function getOverlaySaveTooltip(overlay: OverlayForModeration): string {
  if (!isOverlayModified(overlay.id)) {
    return t('overlay.noChangesToSave')
  }
  if (overlay.status === 'approved') {
    return t('project.submitChangeRequest')
  }
  return t('overlay.publishOverlay')
}

// AI : Handle edit overlay click - opens the shared OverlayEditor dialog via store
// AI : This uses the SAME dialog component that PopupContainer uses
function handleEditOverlayClick(overlay: OverlayForModeration) {
  // AI : Convert OverlayForModeration to OverlayObject for the editor
  // AI : The editor only needs id and caption for editing
  const overlayForEditor = {
    id: overlay.id,
    caption: overlay.name ?? '',
    // AI : Include other required fields from the overlay
    filename: overlay.name ?? '',
    projectId: overlay.projectId ?? null,
    corners: [],
    status: overlay.status,
    isModified: false,
  }

  // AI : Open the shared overlay edit dialog
  // AI : Use unknown as intermediate type since OverlayForModeration doesn't have all OverlayObject fields
  uiStore.openOverlayEditDialog(overlayForEditor as unknown as OverlayObject)
}

// AI : Handle add image to project - open dialog for image upload instructions
function handleAddImageToProject(project: ProjectForModeration) {
  // AI : Open the instructional dialog
  uiStore.openImageUploadDialog(project.id)
}



// AI : Check if project or any of its overlays is modified
function isProjectModified(projectId: string): boolean {
  // AI : First check if the project itself is modified (from edit form)
  const projectInStore = projectStore.projects[projectId]
  if (projectInStore?.isModified) return true

  // AI : Check for any pending modifications in the unified store (matches infopopup logic)
  if (pendingModsStore.getModificationCountForProject(projectId) > 0) {
    return true
  }

  // AI : Check for NEW overlays in overlayStore (status null, never submitted)
  // AI : This catches overlays that were just added but not yet moved
  const hasNewOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.projectId === projectId && (overlay.status === null || overlay.status === undefined)
  )
  if (hasNewOverlays) return true

  // AI : Also check all overlays for this project from displayed projects
  const project = displayedProjects.value.find((p: UserContribution) => p.id === projectId)
  if (!project?.overlays) return false

  return project.overlays.some((overlay: UserContributionOverlay) => isOverlayModified(overlay.id))
}

// AI : Get save button tooltip based on project status and modification state
function getProjectSaveTooltip(project: ProjectForModeration): string {
  if (!isProjectModified(project.id)) {
    return t('overlay.noChangesToSave')
  }
  if (project.status === 'approved') {
    return t('project.submitChangeRequest')
  }
  return t('common.save')
}

// AI : Handle save project click - uses shared submission dialog composable
async function handleSaveProjectClick(project: ProjectForModeration) {
  if (!isProjectModified(project.id)) return

  // AI : Check if project itself has changes (not just overlays)
  const projectInStore = projectStore.projects[project.id]
  const projectHasChanges = projectInStore?.isModified ?? false

  // AI : Use composable to prepare and show submission dialog
  prepareProjectWithOverlaysSubmission(project, projectHasChanges)
}

// AI : Handle edit project click - opens project edit form
function handleEditProjectClick(project: ProjectForModeration) {
  // AI : Get the latest project data from displayedProjects (not the potentially stale passed parameter)
  const latestProjectData = displayedProjects.value.find((p: UserContribution) => p.id === project.id)
  const projectToEdit = latestProjectData ?? project

  // AI : Open the project edit form via uiStore
  // AI : Use unknown as intermediate type since ProjectForModeration may not have all Project fields
  uiStore.openProjectEditForm(projectToEdit as unknown as Project)
}

// AI : Load initial data
onMounted(() => {
  // AI : Force user-only mode to show only this user's change requests, even for moderators
  refreshPendingChangeRequests(true)
})
</script>

<style scoped>
/* AI : Import shared panel CSS */
@import '../../assets/panel-common.css';

/* AI : Custom two-row header layout for My Contributions panel */
.my-contributions-header {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

/* AI : First row - action buttons aligned to the right */
.header-buttons-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  justify-content: flex-end;
  width: 100%;
}

/* AI : Second row - filter checkboxes */
.header-filters-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-checkbox label {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  cursor: pointer;
  white-space: nowrap;
}

/* AI : Breadcrumb styling */
.panel-name {
  color: var(--p-surface-800);
  font-weight: 600;
  flex-shrink: 0;
}

.panel-name.clickable {
  color: var(--p-primary-500);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0.25rem 0.5rem;
  border-radius: var(--p-border-radius);
  margin: -0.25rem -0.5rem;
}

.panel-name.clickable:hover {
  color: var(--p-primary-600);
  background-color: var(--p-primary-50);
}

.separator {
  color: var(--p-surface-400);
  font-weight: 400;
  margin: 0 0.5rem;
  flex-shrink: 0;
}

.city-name {
  color: var(--p-surface-800);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.city-name.clickable {
  color: var(--p-primary-500);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0.25rem 0.5rem;
  border-radius: var(--p-border-radius);
  margin: -0.25rem -0.5rem;
}

.city-name.clickable:hover {
  color: var(--p-primary-600);
  background-color: var(--p-primary-50);
}
</style>
