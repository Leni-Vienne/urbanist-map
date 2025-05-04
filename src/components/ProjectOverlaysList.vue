<template>
  <div class="project-overlays mb-4">
    <h5 class="font-bold mb-2">Project Overlays</h5>
    
    <!-- Empty state -->
    <div
      v-if="overlays.length === 0"
      class="text-center p-3 bg-gray-100 rounded-md"
    >
      No overlays in this project yet
    </div>
    
    <!-- DataTable for overlays -->
    <DataTable
      v-else
      :value="overlays"
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
      
      <!-- AI : Column for actions -->
      <Column header="Actions" :exportable="false" style="width: 100px">
        <template #body="slotProps">
          <div class="flex gap-1 justify-center">
            <Button
              icon="pi pi-eye"
              class="p-button-text p-button-sm"
              @click="$emit('view-overlay', slotProps.data.id)"
              v-tooltip.top="'View overlay'"
            />
            <Button
              icon="pi pi-times"
              class="p-button-text p-button-sm p-button-danger"
              @click="$emit('remove-overlay', slotProps.data.id)"
              v-tooltip.top="'Remove from project'"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';
import type { OverlayObject, OverlayListItem } from '../types';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';

// AI : Define props for the component
const props = defineProps<{
  overlays: OverlayListItem[]
}>();

// AI : Define events emitted by the component
defineEmits<{
  (e: 'remove-overlay', id: string): void
  (e: 'view-overlay', id: string): void
}>();
</script>

<style scoped>
@import "tailwindcss";
</style>