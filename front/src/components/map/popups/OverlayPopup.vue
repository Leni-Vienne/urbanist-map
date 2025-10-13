<template>
  <div class="info-popup">
    <Dialog
      v-model:visible="showModerationDialog"
      modal
      :header="$t('overlay.moderationNotice')"
      :style="{ width: '450px' }"
    >
      <div class="moderation-content">
        <p>{{ isEditSuggestion ? $t('overlay.moderationEditSuggestion') : $t('overlay.moderationNewContent') }}</p>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          severity="secondary"
          @click="showModerationDialog = false"
        />
        <Button
          :label="$t('overlay.proceedWithPublish')"
          severity="success"
          @click="confirmPublish"
        />
      </template>
    </Dialog>

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
        <div class="section-header">Project Assignment</div>
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
            v-tooltip.top="'Edit Project'"
          />
          <!-- AI : Suggest changes button (for non-owned projects) -->
          <Button
            v-else-if="!viewMode && project && user && project.ownerId !== user.id"
            icon="pi pi-file-edit"
            class="p-button-sm p-button-text p-button-secondary"
            @click="emit('edit-project', project)"
            v-tooltip.top="'Suggest Changes'"
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
              v-tooltip.top="'Edit Overlay'"
            />
            <!-- AI : Suggest changes button (for non-owned overlays) -->
            <Button
              v-else-if="!viewMode && overlayObject && user && overlayObject.authorId !== user.id"
              icon="pi pi-file-edit"
              class="p-button-sm p-button-text p-button-secondary"
              @click="emit('edit-overlay', overlayObject)"
              v-tooltip.top="'Suggest Changes'"
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
            class="info-row"
          >
            <span class="info-label">Type:</span>
            <span class="info-value replacement-type">Replacement Overlay</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Publish Overlay Section -->
    <div
      v-if="!viewMode && project"
      class="publish-section"
    >
      <Button
        :label="$t('overlay.publishOverlay')"
        icon="pi pi-cloud-upload"
        severity="success"
        size="small"
        class="w-full"
        :loading="publishLoading"
        @click="handlePublishClick"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@stores/authStore';
import type { OverlayObject, Project } from '@types';
import ProjectMetadataCard from './ProjectMetadataCard.vue';
import Dialog from 'primevue/dialog';
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
}>();

// AI : Use auth store only for user data
const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

// AI : Moderation dialog state
const showModerationDialog = ref(false);

// AI : Determine if this is an edit suggestion (replacesOverlayId exists)
const isEditSuggestion = computed(() => !!props.overlayObject.replacesOverlayId);

// AI : Computed for project picker v-model
const selectedProjectId = computed({
  get: () => props.overlayObject.projectId ?? '',
  set: (_value: string) => {
    // AI : Don't set local state, just emit the change
  }
});

// AI : Handle project selection from picker
function handleProjectSelected(projectId: string) {
  emit('project-change', projectId);
}

// AI : Handle overlay update from editor
function handleOverlayUpdate(overlayId: string, caption?: string) {
  emit('overlay-update', overlayId, caption);
}

// AI : Handle publish button click - show moderation dialog first
function handlePublishClick() {
  showModerationDialog.value = true;
}

// AI : Confirm publish after user acknowledges moderation notice
function confirmPublish() {
  showModerationDialog.value = false;
  emit('publish-overlay');
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

.replacement-type {
  font-weight: 600;
  color: var(--p-purple-500);
}

.publish-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
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