<template>
  <div class="info-popup" @click.stop>
    <div
      v-if="loading"
      class="loading-spinner"
    >
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div
      v-else
      class="project-details"
    >
      <!-- Project Selection Section - Only visible in edit mode -->
      <div
        v-if="!viewMode"
        class="project-selection"
      >
        <div class="section-header">{{ $t('project.assignTo') }}</div>
        <ProjectPicker
          v-model="selectedProjectId"
          @project-selected="handleProjectSelected"
          :hideSelector="false"
          :useCityProjects="true"
          :placeholder="project ? 'Change project' : 'Select a project'"
        />
      </div>

      <!-- Project Information Section -->
      <ProjectMetadataCard
        :project="project ?? null"
        :show-description="false"
        :show-coordinates="false"
        :available-cities="availableCities"
      >
        <template #actions="{ project }">
          <!-- AI : Direct edit button (for owned projects or moderator pending projects) -->
          <Button
            v-if="!viewMode && project && user && project.ownerId === user.id"
            icon="pi pi-pencil"
            class="p-button-sm p-button-text p-button-info"
            @click="emit('edit-project', project)"
            v-tooltip.top="$t('tooltips.editProject')"
          />
          <!-- AI : Suggest changes button (for non-owned projects) -->
          <Button
            v-else-if="!viewMode && project && user && project.ownerId !== user.id"
            icon="pi pi-file-edit"
            class="p-button-sm p-button-text p-button-secondary"
            @click="emit('edit-project', project)"
            v-tooltip.top="$t('tooltips.suggestChanges')"
          />
        </template>
      </ProjectMetadataCard>

      <!-- Overlay Information Section -->
      <div class="">
        <div class="section-header-row">
          <div class="section-header">{{ $t("overlay.overlayInformation") }}</div>
          <div class="overlay-actions">
            <!-- AI : Direct edit button (for owned overlays) -->
            <Button
              v-if="!viewMode && overlayObject && user && overlayObject.authorId === user.id"
              icon="pi pi-pencil"
              class="p-button-sm p-button-text p-button-info"
              @click="emit('edit-overlay', overlayObject)"
              v-tooltip.top="$t('tooltips.editOverlay')"
            />
            <!-- AI : Suggest changes button (for non-owned overlays) -->
            <Button
              v-else-if="!viewMode && overlayObject && user && overlayObject.authorId !== user.id"
              icon="pi pi-file-edit"
              class="p-button-sm p-button-text p-button-secondary"
              @click="emit('edit-overlay', overlayObject)"
              v-tooltip.top="$t('tooltips.suggestChanges')"
            />
          </div>
        </div>

        <div class="info-card">
          <div class="info-row">
            <span class="info-label">{{$t("common.name")}}:</span>
            <span class="info-value">{{ overlayObject.caption ?? '—' }}</span>
          </div>
          <div
            v-if="overlayObject.replacesOverlayId"
            class="info-row replacement-info"
          >
            <button
              class="replacement-link-button"
              @click.stop="handleViewOriginalOverlay"
            >
              <i class="pi pi-arrow-left"></i>
              {{ $t('overlay.viewOriginalOverlay') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Publish Overlay Section -->
    <!-- AI : Show publish button in edit mode when overlay or project has been modified -->
    <div
      v-if="!viewMode && project"
      class="publish-section"
    >
      <Button
        :label="overlayObject.status === 'approved' ? $t('overlay.submitChangeRequest') : $t('overlay.publishOverlay')"
        :icon="overlayObject.status === 'approved' ? 'pi pi-send' : 'pi pi-cloud-upload'"
        :severity="overlayObject.status === 'approved' ? 'info' : 'success'"
        :disabled="!hasChanges"
        size="small"
        class="w-full"
        :loading="publishLoading"
        @click="handlePublishClick"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@stores/authStore';
import type { OverlayObject, Project } from '@types';
import ProjectMetadataCard from './ProjectMetadataCard.vue';
import { useI18n } from 'vue-i18n';

const ProjectPicker = defineAsyncComponent(() => import('@components/project/ProjectPicker.vue'));
const { t: $t } = useI18n();

// AI : Props - all data comes from parent
const props = defineProps<{
  overlayObject: OverlayObject;
  project?: Project | null;
  viewMode?: boolean;
  publishLoading?: boolean;
  loading?: boolean;
  availableCities?: Array<{ id: string; name: string; countryCode: string; }>;
}>();

// AI : Events - all actions are emitted to parent
const emit = defineEmits<{
  'project-change': [projectId: string];
  'publish-overlay': [];
  'edit-project': [project: Project];
  'edit-overlay': [overlay: OverlayObject];
  'overlay-update': [overlayId: string, caption?: string];
  'view-original-overlay': [overlayId: string];
}>();

// AI : Use auth store only for user data
const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

// AI : Check if overlay or project has changes that need to be published
const hasChanges = computed(() => {
  const overlayModified = props.overlayObject.isModified || false;
  const projectModified = props.project?.isModified || false;
  return overlayModified || projectModified;
});

// AI : Local ref for selected project ID (synced with overlay's projectId)
const selectedProjectId = ref(props.overlayObject.projectId ?? '');

// AI : Watch for overlay projectId changes to sync local state
watch(() => props.overlayObject.projectId, (newProjectId) => {
  selectedProjectId.value = newProjectId ?? '';
}, { immediate: true });

// AI : Handle project selection from picker
function handleProjectSelected(projectId: string) {
  selectedProjectId.value = projectId;
  emit('project-change', projectId);
}

// AI : Handle overlay update from editor
function handleOverlayUpdate(overlayId: string, caption?: string) {
  emit('overlay-update', overlayId, caption);
}

// AI : Handle publish button click - directly emit to parent (parent shows confirmation dialog)
function handlePublishClick() {
  emit('publish-overlay');
}

// AI : Handle view original overlay click - navigate to the original overlay being replaced
function handleViewOriginalOverlay() {
  if (props.overlayObject.replacesOverlayId) {
    emit('view-original-overlay', props.overlayObject.replacesOverlayId);
  }
}
</script>

<style scoped>
@import '@assets/info-card-shared.css';

.info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: var(--p-surface-0);
  cursor: text;
  user-select: text;
  border-radius: 0.75rem;
  /* AI : So that the popup sits above the toolbar, no matter its height */
  translate: 0px calc(2px);
  box-shadow: var(--p-shadow-md);
  /* AI : Compact styles for InfoPopup */
  max-width: 300px;
  border: 1px solid var(--p-surface-border);
  /* AI : Prevent dev tools interference */
  pointer-events: auto;
  position: relative;
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.info-popup .p-button-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.project-selection {
  margin-bottom: 1rem;
}

.overlay-actions {
  display: flex;
  gap: 0.25rem;
}

.replacement-info {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--p-surface-200);
}

.replacement-link-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--p-purple-600);
  background-color: var(--p-purple-50);
  border: 1px solid var(--p-purple-200);
  border-radius: 0.375rem;
  cursor: pointer;
  padding: 0.375rem 0.75rem;
  transition: all 0.2s;
  width: 100%;
  justify-content: center;
}

.replacement-link-button:hover {
  background-color: var(--p-purple-100);
  border-color: var(--p-purple-300);
  color: var(--p-purple-700);
}

.replacement-link-button i {
  font-size: 0.875rem;
}

.publish-section {
  margin-top: 1rem;
}

.moderation-content p {
  margin-bottom: 1rem;
  color: var(--p-surface-700);
}

.moderation-content {
  padding: 0.5rem 0;
  line-height: 1.6;
  font-weight: 500;
  color: var(--p-primary-500);
  margin-bottom: 0;
}
</style>