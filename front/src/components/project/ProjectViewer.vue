<template>
  <div class="project-view">
    <ProjectHeader
      :project="project"
      :formatDate="formatDate"
    />

    <ProjectOverlaysSection
      :project="project"
      :overlays="projectOverlaysListItems"
      @view="viewOverlay"
      @remove="removeOverlayFromProject"
      @add-overlay="showAddOverlayDialog = true"
    />

    <ProjectActions
      :isHighlighted="isHighlighted"
      @toggle-highlight="toggleHighlight"
      @edit-project="editProject"
      @go-back="goBack"
    />

    <AddOverlayDialog
      v-model:visible="showAddOverlayDialog"
      :availableOverlays="availableOverlays"
      @add="addOverlayToProject"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, inject, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectEditor } from '@composables/project/useProjectEditor';
import { useProjectOverlayManager } from '@composables/project/useProjectOverlayManager';
import { useProjectHighlight } from '@composables/project/useProjectHighlight';
import { goBack } from '@composables/ui/useRouterNavigation';
import type { Project, OverlayListItem } from '@types';
import ProjectHeader from '@components/project/ProjectHeader.vue';
import ProjectOverlaysSection from '@components/project/ProjectOverlaysSection.vue';
import ProjectActions from '@components/project/ProjectActions.vue';
import AddOverlayDialog from '@components/dialogs/AddOverlayDialog.vue';

interface Props {
  project: Project;
  projectId: string;
}

const props = defineProps<Props>();
const router = useRouter();

// AI : Use composables for specific functionality
const {
  projectOverlays,
  loadProjectOverlays,
  formatDate
} = useProjectEditor(props.projectId, 'view');

const {
  showAddOverlayDialog,
  availableOverlays,
  addOverlayToProject,
  removeOverlayFromProject,
  viewOverlay
} = useProjectOverlayManager(props.projectId, loadProjectOverlays);

const { isHighlighted, toggleHighlight } = useProjectHighlight(props.projectId);

// AI : Convert overlays to list items for display
const projectOverlaysListItems = computed<OverlayListItem[]>(() =>
  projectOverlays.value.map(overlay => ({
    id: overlay.id,
    caption: overlay.caption ?? undefined // AI : Convert null to undefined for OverlayListItem type
  }))
);

// AI : Navigation methods
const editProject = () => {
  router.push(`/projects/${props.projectId}/edit`);
};

</script>

<style scoped>
.project-view {
  max-width: 800px;
  margin: 0 auto;
}
</style>
