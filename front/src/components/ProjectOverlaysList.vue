<template>
  <div class="project-overlays p-4">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-xl font-bold">{{ projectTitle }}</h3>
      <Button
        label="Back to Project"
        icon="pi pi-arrow-left"
        class="p-button-outlined"
        @click="goBackToProject"
      />
    </div>
    
    <div class="mb-4">
      <h5 class="font-bold mb-2">Project Overlays</h5>
      
      <!-- Empty state -->
      <div
        v-if="projectOverlays.length === 0"
        class="text-center p-3 bg-gray-100 rounded-md"
      >
        No overlays in this project yet
      </div>
      
      <!-- DataTable for overlays -->
      <DataTable
        v-else
        :value="projectOverlays"
        stripedRows
        class="p-datatable-sm"
        responsiveLayout="scroll"
      >
        <!-- AI : Column for overlay name/phase -->
        <Column field="phase" header="Phase">
          <template #body="slotProps">
            {{ slotProps.data.phase || 'Unnamed Overlay' }}
          </template>
        </Column>
        
        <!-- AI : Column for sequence number -->
        <Column field="sequenceNumber" header="Sequence" style="width: 100px">
          <template #body="slotProps">
            {{ slotProps.data.sequenceNumber || '-' }}
          </template>
        </Column>
        
        <!-- AI : Column for actions -->
        <Column header="Actions" :exportable="false" style="width: 150px">
          <template #body="slotProps">
            <div class="flex gap-1 justify-center">
              <Button
                icon="pi pi-eye"
                class="p-button-text p-button-sm"
                @click="viewOverlay(slotProps.data.id)"
                v-tooltip.top="'View overlay'"
              />
              <Button
                icon="pi pi-times"
                class="p-button-text p-button-sm p-button-danger"
                @click="removeFromProject(slotProps.data.id)"
                v-tooltip.top="'Remove from project'"
              />
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <Button
      label="Back to Projects List"
      icon="pi pi-list"
      class="p-button-text w-full"
      @click="goToProjectsList"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from '../composables/useToast';
import { projects } from '../composables/useProjects';
import type { OverlayListItem } from '@types';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';

// AI : Define props for the component
const props = defineProps<{
  projectId?: string;
  overlays?: OverlayListItem[];
}>();

// AI : Define emits for the component
const emit = defineEmits<{
  view: [overlayId: string];
  remove: [overlayId: string];
}>();

const router = useRouter();
const toast = useToast();

// AI : Use props overlays directly instead of loading them
const projectOverlays = computed(() => {
  return props.overlays || [];
});

// AI : Computed property for project title
const projectTitle = computed(() => {
  if (!props.projectId) return 'Project Overlays';
  const project = projects.value[props.projectId];
  return project ? `${project.name} - Overlays` : 'Project Overlays';
});

// AI : Navigation functions
function goBackToProject() {
  if (props.projectId) {
    router.push(`/projects/${props.projectId}`);
  } else {
    router.push('/projects');
  }
}

function goToProjectsList() {
  router.push('/projects');
}

// AI : View overlay function
async function viewOverlay(overlayId: string) {
  emit('view', overlayId);
}

// AI : Remove overlay from project
async function removeFromProject(overlayId: string) {
  emit('remove', overlayId);
}


</script>

<style scoped>
@import "tailwindcss";

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