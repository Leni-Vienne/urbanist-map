<template>
  <div class="project-overlays p-4">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-xl font-bold">{{ overlayTitle }}</h3>
      <Button
        :label="isViewMode ? 'Back to Map' : 'Back to Project'"
        icon="pi pi-arrow-left"
        class="p-button-outlined"
        @click="goBack"
      />
    </div>

    <div class="mb-4">
      <h5 class="font-bold mb-2">{{ overlaySubtitle }}</h5>
      <!-- Loading state -->
      <div
        v-if="loading"
        class="text-center p-3 bg-blue-100 rounded-md"
      >
        Loading overlays...
      </div>

      <!-- Empty state -->
      <div
        v-else-if="projectOverlays.length === 0"
        class="text-center p-3 bg-gray-100 rounded-md"
      >
        {{ emptyMessage }}
      </div>

      <!-- DataTable for overlays -->
      <DataTable
        v-else
        :value="projectOverlays"
        stripedRows
        class="p-datatable-sm"
        responsiveLayout="scroll"
      >
        <!-- AI : Column for overlay name/caption -->
        <Column
          field="caption"
          header="caption"
        >
          <template #body="slotProps"> {{ slotProps.data.caption ?? 'Unnamed Overlay' }}
          </template>
        </Column>

        <!-- AI : Column for distance in view mode -->
        <Column
          v-if="isViewMode"
          field="distance"
          header="Distance"
          style="width: 120px"
        >
          <template #body="slotProps">
            {{ formatDistance(slotProps.data.distance) }}
          </template>
        </Column>

        <!-- AI : Column for actions -->
        <Column
          header="Actions"
          :exportable="false"
          :style="isViewMode ? 'width: 100px' : 'width: 150px'"
        >
          <template #body="slotProps">
            <div class="flex gap-1 justify-center">
              <Button
                icon="pi pi-eye"
                class="p-button-text p-button-sm"
                @click="viewOverlay(slotProps.data.id)"
                v-tooltip.top="'View overlay'"
              />
              <Button
                v-if="!isViewMode"
                icon="pi pi-times"
                class="p-button-text p-button-sm p-button-danger"
                @click="removeFromProject(slotProps.data.id)"
                v-tooltip.top="'Remove from project'"
              />
            </div>
          </template>
        </Column>
      </DataTable>
    </div> <Button
      :label="isViewMode ? 'Back to Map' : 'Back to Projects List'"
      :icon="isViewMode ? 'pi pi-map' : 'pi pi-list'"
      class="p-button-text w-full"
      @click="goToProjectsList"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from '@composables/ui/useToast';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { useProjects } from '@composables/project/useProjects';
import type { OverlayListItem, CameraBounds } from '@types';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';

// AI : Define props for the component
const props = defineProps<{
  projectId?: string;
  overlays?: OverlayListItem[];
  cameraBounds?: CameraBounds;
  isViewMode?: boolean;
}>();

// AI : Define emits for the component
const emit = defineEmits<{
  view: [overlayId: string];
  remove: [overlayId: string];
}>();

const router = useRouter();
const toast = useToast();

// AI : Get store refs using the composable pattern
const { projects } = useProjects();

// AI : Use view mode overlays composable
const {
  viewModeOverlays,
  loading,
  error,
  startCameraTracking,
  stopCameraTracking,
  clearOverlays
} = useViewModeOverlays();

// AI : Watch for view mode changes to start/stop camera tracking
watch(() => props.isViewMode, (isViewMode) => {
  if (isViewMode) {
    startCameraTracking();
  } else {
    stopCameraTracking();
    clearOverlays();
  }
}, { immediate: true });

// AI : Watch for toast errors
watch(error, (errorMsg) => {
  if (errorMsg) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: errorMsg
    });
  }
});

// AI : Computed property for displayed overlays
const displayedOverlays = computed(() => {
  if (props.isViewMode) {
    // AI : Convert CDN overlay data to OverlayListItem format for display
    return viewModeOverlays.value.map(overlay => ({
      id: overlay.id, caption: overlay.caption,
      distance: overlay.distance,
      filename: overlay.filename // AI : Keep filename for CDN usage
    }));
  }
  return props.overlays ?? [];
});

// AI : Use props overlays directly instead of loading them
const projectOverlays = computed(() => {
  return displayedOverlays.value;
});

// AI : Computed properties for titles and messages
const overlayTitle = computed(() => {
  if (props.isViewMode) {
    return 'Overlays in View';
  }
  if (!props.projectId) return 'Project Overlays';
  const project = projects.value[props.projectId];
  return project ? `${project.name} - Overlays` : 'Project Overlays';
});

const overlaySubtitle = computed(() => {
  if (props.isViewMode) {
    return 'Overlays intersecting current view';
  }
  return 'Project Overlays';
});

const emptyMessage = computed(() => {
  if (props.isViewMode) {
    return 'No overlays found in current view';
  } return 'No overlays in this project yet';
});

// AI : Format distance for display
function formatDistance(distance?: number): string {
  if (distance === undefined) return '-';
  if (distance < 1000) {
    return `${Math.round(distance)}m`;
  }
  return `${(distance / 1000).toFixed(1)}km`;
}

// AI : Navigation functions
function goBack() {
  if (props.isViewMode) {
    router.push('/map');
  } else if (props.projectId) {
    router.push(`/projects/${props.projectId}`);
  } else {
    router.push('/projects');
  }
}

function goBackToProject() {
  if (props.projectId) {
    router.push(`/projects/${props.projectId}`);
  } else {
    router.push('/projects');
  }
}

function goToProjectsList() {
  if (props.isViewMode) {
    router.push('/map');
  } else {
    router.push('/projects');
  }
}

// AI : View overlay function
async function viewOverlay(overlayId: string) {
  emit('view', overlayId);
}

// AI : Remove overlay from project (only in project mode)
async function removeFromProject(overlayId: string) {
  if (!props.isViewMode) {
    emit('remove', overlayId);
  }
}


</script>

<style scoped>

/* Adjust styles to work better within AppLayout */
.project-overlays {
  width: 100%;
  max-width: 100%;
  margin: 0;
  background-color: transparent;
  box-shadow: none;
  padding: 0;
}
</style>