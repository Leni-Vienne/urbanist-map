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
      <div class="header-actions-container">
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
            <Badge
              :value="moderatedContributionsCount"
              severity="danger"
              class="mr-2"
            />
            <i class="pi pi-bell"></i>
          </template>
        </Button>

        <!-- AI : New Project button - primary action with icon only on small screens -->
        <Button
          @click="handleAddOverlayClick"
          severity="primary"
          size="small"
          icon="pi pi-plus"
          :label="$t('common.add')"
          class="add-project-button"
          v-tooltip.bottom="$t('dialog.createNewProject')"
        />

        <div class="filter-controls">
          <div class="field-checkbox">
            <Checkbox
              v-model="onlyShowPending"
              inputId="onlyShowPending"
              binary
            />
            <label for="onlyShowPending">{{ $t('help.filters.onlyShowPending') }}</label>
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
import { useNewProject } from '@composables/overlay/useNewProject'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import { useToast } from '@composables/ui/useToast'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useUserContributions } from '@composables/project/useUserContributions'
import { useModeratedContributions } from '@composables/moderation/useModeratedContributions'
import { useUiStore } from '@stores/uiStore'
import { useProjectDeletion } from '@composables/project/useProjectDeletion'

const { t } = useI18n()

// AI : Use cached composable for user contributions
const { projects, isLoading, fetchUserContributions } = useUserContributions()

// AI : Use deletion composable for delete operations
const { handleDeleteOverlay: deleteOverlayWithMarker, handleDeleteProject: deleteProjectWithConfirm } = useProjectDeletion()

// AI : Moderated contributions state
const { moderatedContributions, hasUnacknowledgedItems } = useModeratedContributions()
const uiStore = useUiStore()
const moderatedContributionsCount = computed(() => moderatedContributions.value.length)

const onlyShowPending = ref(true)

// AI : New project composable
const { handleNewProjectClick } = useNewProject()

async function handleAddOverlayClick() {
  const result = await handleNewProjectClick()

  if (!result.success && result.reason === 'edit_mode_error') {
    toast.add({
      severity: 'error',
      summary: t('moderation.modeSwitchError'),
      detail: t('moderation.modeSwitchErrorDetail'),
      life: 3000
    })
  }
  // AI : No toast for success - dialog opening is self-explanatory
}
const toast = useToast()

// AI : Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } = useChangeRequests()

// AI : Computed filtered projects
const filteredProjects = computed(() => {
  if (onlyShowPending.value) {
    // AI : Show projects that are pending OR have pending overlays/change requests
    return projects.value.filter(project => {
      // AI : If the project itself is pending, include it
      if (project.status === 'pending') {
        return true
      }

      // AI : If project has pending overlays (user's suggestions on approved projects), include it
      const hasPendingOverlays = project.overlays?.some((overlay: any) => overlay.status === 'pending') ?? false
      if (hasPendingOverlays) {
        return true
      }

      // AI : If project has pending change requests (user's suggestions), include it
      const hasPendingChanges = pendingChangeRequests.value.some(change => {
        if (change.entityType === 'project' && change.entityId === project.id) {
          return true
        }
        // AI : Check if any overlay in this project has pending changes
        return project.overlays?.some((overlay: any) =>
          change.entityType === 'overlay' && change.entityId === overlay.id
        ) ?? false
      })

      return hasPendingChanges
    })
  }
  return projects.value
})

// AI : Delete handlers with confirmation
async function handleDeleteOverlayClick(overlay: any) {
  // AI : Find the project that contains this overlay
  const project = projects.value.find(p =>
    p.overlays?.some((o: any) => o.id === overlay.id)
  )

  const overlayCount = project?.overlays?.length ?? 0
  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.name)
}

async function handleDeleteProjectClick(project: any) {
  await deleteProjectWithConfirm(project.id, project.name, project.overlays?.length ?? 0)
}

async function handleDeleteChangeRequestClick(change: any) {
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
/* AI : Component-specific styles - most moved to shared component */
.header-actions-container {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  width: 100%;
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
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

/* AI : Add overlay button styling */
.add-overlay-button {
  margin-top: 1rem;
  min-width: 160px;
  padding: 0.75rem 1.5rem;
  font-weight: 600;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

/* AI : Delete button styling */
.delete-btn {
  color: var(--p-red-600);
  transition: all 0.2s ease;
}

.delete-btn:hover {
  color: var(--p-red-700);
  background-color: var(--p-red-50);
}
</style>
