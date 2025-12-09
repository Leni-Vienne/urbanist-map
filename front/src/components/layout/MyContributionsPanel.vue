<template>
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="pendingChangeRequests"
    title=""
    panel-class="my-contributions-panel"
    :empty-message="projects.length > 0 && filteredProjects.length === 0 ? $t('contributions.noProjectsMatchFilter') : $t('contributions.noProjectsFound')"
    :empty-sub-message="projects.length > 0 && filteredProjects.length === 0 ? $t('contributions.tryChangingFilters') : $t('contributions.createFirstProject')"
  >
    <template #project-actions="{ project }">
      <button
        v-if="project.status === 'pending'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteProjectClick(project)"
        v-tooltip.top="$t('contributions.deleteProject')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #overlay-actions="{ overlay }">
      <button
        v-if="overlay.status === 'pending'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteOverlayClick(overlay)"
        v-tooltip.top="$t('contributions.deleteOverlay')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        v-if="change.status === 'pending' || change.status === 'conflicted'"
        class="action-btn delete-btn"
        @click.stop="handleDeleteChangeRequestClick(change)"
        v-tooltip.top="$t('contributions.deleteChangeRequest')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #header-actions>
      <div class="my-contributions-header">
        <!-- AI : First row - action buttons -->
        <div class="header-buttons-row">
          <!-- AI : Moderation results button -->
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

          <!-- AI : New Project button - aligned to the right like CurrentCityPanel -->
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

        <!-- AI : Second row - filter checkboxes -->
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

    <template #empty-state>
      <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
      <p class="text-base mb-2">
        {{ projects.length > 0 && filteredProjects.length === 0 ? $t('contributions.noProjectsMatchFilter') :
          $t('contributions.noProjectsFound') }}
      </p>
      <p class="text-sm">
        {{ projects.length > 0 && filteredProjects.length === 0 ? $t('contributions.tryChangingFilters') :
          $t('contributions.createFirstProject') }}
      </p>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAddOverlay } from '@/composables/overlay/useAddOverlay'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import { useToast } from '@/composables/ui/useToast'
import { useChangeRequests } from '@/composables/changes/useChanges'
import { useUserContributions } from '@/composables/project/useUserContributions'
import { useModeratedContributions } from '@/composables/moderation/useModeratedContributions'
import { useUiStore } from '@/stores/uiStore'
import { useProjectDeletion } from '@/composables/project/useProjectDeletion'
import type { RouterOutput } from '@/client'
import type { ProjectForModeration, OverlayForModeration } from '@/types/index'

// AI : Type definitions from tRPC backend responses
type UserContribution = RouterOutput['project']['getUsersContributions']['projects'][number]
type UserContributionOverlay = UserContribution['overlays'][number]
type ChangeRequest = RouterOutput['changes']['getPendingChangeRequests'][0]

const { t } = useI18n()

// AI : Use cached composable for user contributions
const { projects, isLoading, fetchUserContributions } = useUserContributions()

// AI : Use deletion composable for delete operations
const { handleDeleteOverlay: deleteOverlayWithMarker, handleDeleteProject: deleteProjectWithConfirm } = useProjectDeletion()

// AI : Moderated contributions state
const { moderatedContributions, hasUnacknowledgedItems } = useModeratedContributions()
const uiStore = useUiStore()
const moderatedContributionsCount = computed(() => moderatedContributions.value.length)

// AI : Filter state - both true by default to show everything
const showPending = ref(true)
const showApproved = ref(true)

// AI : Use shared composable for add overlay button
const { handleAddOverlayClick } = useAddOverlay()

// AI : Toast for delete operations
const toast = useToast()

// AI : Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } = useChangeRequests()

// AI : Computed filtered projects based on two independent checkboxes
const filteredProjects = computed(() => {
  // AI : If neither checkbox is selected, show nothing
  if (!showPending.value && !showApproved.value) {
    return []
  }

  // AI : If both are selected, show everything
  if (showPending.value && showApproved.value) {
    return projects.value
  }

  // AI : Filter based on which checkbox(es) are selected
  return projects.value.filter(project => {
    const isPending = project.status === 'pending'
    const isApproved = project.status === 'approved' || project.status === 'rejected' || project.status === 'replaced'

    // AI : Check if project has pending overlays/changes (contributes to "pending")
    const hasPendingOverlays = project.overlays?.some((overlay: UserContributionOverlay) => overlay.status === 'pending') ?? false
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

// AI : Delete handlers with confirmation
async function handleDeleteOverlayClick(overlay: OverlayForModeration) {
  // AI : Find the project that contains this overlay
  const project = projects.value.find(project =>
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
  const confirmed = confirm(t('contributions.confirmDeleteChangeRequest', { field: fieldName }))
  if (!confirmed) return

  const result = await deleteChangeRequest(change.id)
  if (result?.success) {
    toast.add({
      severity: 'success',
      summary: t('contributions.changeRequestDeleted'),
      life: 3000
    })
  }
}

// AI : Load initial data
onMounted(() => {
  fetchUserContributions()
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
</style>
