<template>
    <div class="edit-mode-toggle-container">
        <!-- AI : Edit mode toggle button -->
        <div class="card flex">
            <Button
                :icon="currentIcon"
                @click="handleModeToggle"
                class="p-button-rounded edit-mode-toggle"
                :class="buttonClass"
                v-tooltip.right="tooltipText"
                aria-label="Toggle Edit Mode"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { toggleEditMode } from '@composables/overlay/useEditMode';
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

// AI : Computed button class for different colors
const buttonClass = computed(() => {
    if (isEditMode?.value) {
        return 'edit-mode-active';
    }
    return 'view-mode-active';
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
        await toggleEditMode();

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

<style scoped>
.edit-mode-toggle-container {
    position: relative;
}

/* AI : Base circular button styling */
:deep(.edit-mode-toggle) {
    transition: all 0.2s ease;
}

/* AI : View mode styling (default/secondary) */
:deep(.view-mode-active) {
    background: #6c757d;
    border-color: #6c757d;
    color: white;
}

:deep(.view-mode-active:hover:not(:disabled)) {
    background: #5a6268;
    border-color: #545b62;
    transform: scale(1.05);
}

/* AI : Edit mode styling (primary/warning) */
:deep(.edit-mode-active) {
    background: #ffc107;
    border-color: #ffc107;
    color: #212529;
}

:deep(.edit-mode-active:hover:not(:disabled)) {
    background: #e0a800;
    border-color: #d39e00;
    transform: scale(1.05);
}

/* AI : Disabled state */
:deep(.edit-mode-toggle:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
}
</style>
