<template>
  <div>
    <!-- Edit Overlay Dialog -->
    <Dialog 
      v-model:visible="showDialog" 
      header="Edit Overlay Information" 
      :modal="true"
      :closable="true"
      :closeOnEscape="true"
      :dismissableMask="true"
      :draggable="false"
      :resizable="false"
      :appendTo="bodyElement"
      :transitionOptions="{disabled:true}"
      @keydown.stop
      @keyup.stop
      @keypress.stop
    >      <div class="p-fluid">
        <div class="field mb-4">
          <FloatLabel
            class="w-full"
            variant="in"
          >
            <InputText 
              id="overlay-name-input"
              v-model="editingInfo.caption" 
              class="w-full p-3"
            />
            <label for="overlay-name-input" class="text-gray-600">Overlay Name</label>
          </FloatLabel>
        </div>
      </div>
      <template #footer>
        <Button 
          label="Cancel" 
          icon="pi pi-times" 
          @click="showDialog = false" 
          class="p-button-text"
        />
        <Button 
          label="Save Changes" 
          icon="pi pi-check" 
          @click="saveChanges" 
          class="p-button-primary"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '@composables/ui/useToast';
import { updateTooltipText, updateOverlayInfo } from '@composables/overlay/useOverlayActions';
import type { OverlayObject } from '@types';

// AI : Define document.body as a variable to avoid TypeScript errors
const bodyElement = document.body;

// AI : Define props for component
const props = defineProps<{
  overlayObject: OverlayObject;
}>();

// AI : Define emits for the component
const emit = defineEmits<(e: 'update', overlayId: string, caption?: string) => void>();

const toast = useToast();
const showDialog = ref(false);

// AI : Local state for editing overlay information
const editingInfo = ref({
  caption: ''
});

// AI : Open the dialog for editing overlay information
function openDialog() {
  // AI : Reset form with current values from the overlay object
  editingInfo.value = {
    caption: props.overlayObject.caption ?? ''
  };
  showDialog.value = true;
}

// AI : Save changes to the overlay
function saveChanges() {
  try {
    // AI : Update overlay info using existing function
    updateOverlayInfo(props.overlayObject.id, {
      caption: editingInfo.value.caption ?? undefined
    });
    
    // AI : Update the tooltip text
    updateTooltipText();
    
    // AI : Emit update event
    emit('update', props.overlayObject.id, editingInfo.value.caption);
    
    // AI : Show success message
    toast.add({
      severity: 'success',
      summary: 'Overlay Updated',
      detail: 'Overlay information has been updated successfully',
      life: 3000
    });
    
    // AI : Close dialog
    showDialog.value = false;
  } catch (error) {
    console.error('Error updating overlay:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update overlay information',
      life: 3000
    });
  }
}

// AI : Expose the openDialog function to parent components
defineExpose({
  openDialog
});
</script>