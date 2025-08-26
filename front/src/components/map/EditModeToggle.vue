<template>
    <!-- AI : Edit mode toggle button -->
    <Button
        :icon="currentIcon"
        @click="handleModeToggle"
        @dblclick.stop
        :severity="buttonSeverity"
        class="map-control-button"
        v-tooltip.right="tooltipText"
        aria-label="Toggle Edit Mode"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { toggleEditMode } from '@composables/overlay/useOverlayModes';
import { handleEditModeExit } from '@composables/map/useCityMarkers';
import { useToast } from '@composables/ui/useToast';
import { storeToRefs } from 'pinia';

// AI : Get overlay store
const overlayStore = useOverlayStore();
const { isEditMode } = storeToRefs(overlayStore);
const toast = useToast();

// AI : Computed icon based on current mode
const currentIcon = computed(() => {
    return isEditMode?.value ? 'pi pi-pencil' : 'pi pi-eye';
});

// AI : Computed button severity for different colors
const buttonSeverity = computed(() => {
    if (isEditMode?.value) {
        return 'warning'; // Orange/yellow for edit mode
    }
    return 'secondary'; // Gray for view mode
});

// AI : Computed tooltip text with comprehensive feedback
const tooltipText = computed(() => {
    const currentMode = isEditMode?.value ? 'Edit Mode' : 'View Mode';
    const actionText = isEditMode?.value ? 'Switch to View Mode' : 'Switch to Edit Mode';

    // Show current state and what clicking will do
    return `Currently in ${currentMode} - Click to ${actionText.toLowerCase()}`;
});

// AI : Handle toggle change
async function handleModeToggle() {
    try {
        await toggleEditMode(handleEditModeExit);

        // AI : Show toast notification for mode change
        const modeText = isEditMode?.value ? 'Edit Mode' : 'View Mode';
        toast.add({
            severity: 'info',
            summary: `Switched to ${modeText}`,
            detail: isEditMode?.value
                ? 'You can now add and edit overlays'
                : 'Overlays are now in view-only mode',
            life: 3000
        });
    } catch (error) {
        console.error('AI : Error toggling edit mode:', error);

        toast.add({
            severity: 'error',
            summary: 'Mode Switch Error',
            detail: 'Failed to switch mode. Please try again.',
            life: 3000
        });
    }
}
</script>