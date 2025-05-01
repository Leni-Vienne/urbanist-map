import { ref } from 'vue';

export type ProjectManagerMode = 'list' | 'edit' | 'view';

// Dialog state
const isVisible = ref(false);
const mode = ref<ProjectManagerMode>('list');
const action = ref('');

// Functions to control the dialog
function openProjectManager(openMode: ProjectManagerMode = 'list', openAction: string = '') {
    mode.value = openMode;
    action.value = openAction;
    isVisible.value = true;
}

function closeProjectManager() {
    isVisible.value = false;
}

// Export the composable
export function useProjectManagerDialog() {
    return {
        isVisible,
        mode,
        action,
        openProjectManager,
        closeProjectManager
    };
}