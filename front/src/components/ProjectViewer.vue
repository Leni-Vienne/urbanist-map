<template>
  <div class="project-view">
    <ProjectHeader :project="project" :formatDate="formatDate" />
    
    <ProjectOverlaysSection
      :project="project"
      :overlays="projectOverlays"
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
import { useProjectEditor } from '@composables/useProjectEditor';
import { useProjectOverlayManager } from '@composables/useProjectOverlayManager';
import { useProjectHighlight } from '@composables/useProjectHighlight';
import { initializeOverlays } from '@composables/overlay/useOverlay';
import { goBack } from '@composables/ui/useRouterNavigation';
import type { Project, OverlayListItem } from '@types';
import ProjectHeader from '@components/ProjectHeader.vue';
import ProjectOverlaysSection from '@components/ProjectOverlaysSection.vue';
import ProjectActions from '@components/ProjectActions.vue';
import AddOverlayDialog from '@components/AddOverlayDialog.vue';

interface Props {
  project: Project;
  projectId: string;
}

const props = defineProps<Props>();
const router = useRouter();

// AI : Inject database initialization status
const databaseInitialized = inject('databaseInitialized', ref(false));

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

const { isHighlighted, toggleHighlight, clearHighlightOnModeChange } = useProjectHighlight(props.projectId);

// AI : Convert overlays to list items for display
const projectOverlaysListItems = computed<OverlayListItem[]>(() =>
  projectOverlays.value.map(overlay => ({
    id: overlay.id,
    phase: overlay.phase,
    sequenceNumber: overlay.sequenceNumber
  }))
);

// AI : Navigation methods
const editProject = () => {
  router.push(`/projects/${props.projectId}/edit`);
};

// AI : Initialize overlays on mount
onMounted(async () => {
  const initializeData = async () => {
    try {
      await initializeOverlays();
      await loadProjectOverlays();
    } catch (error) {
      console.error('ProjectViewer - error initializing:', error);
    }
  };

  if (databaseInitialized.value) {
    await initializeData();
  } else {
    const unwatch = watch(databaseInitialized, async (initialized) => {
      if (initialized) {
        unwatch();
        await initializeData();
      }
    });
  }
});
</script>

<style scoped>
.project-view {
  max-width: 800px;
  margin: 0 auto;
}
</style>
