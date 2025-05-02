import { ref } from 'vue';

export type ProjectManagerMode = 'list' | 'edit' | 'view' | 'create';

// Dialog visibility state
const isVisible = ref(false);
const initialProjectName = ref('');
const currentMode = ref<ProjectManagerMode>('list');
const previousMode = ref<ProjectManagerMode | null>(null);
const currentProjectId = ref<string>('');

// Functions to control the dialog
function openProjectManager(openMode: ProjectManagerMode = 'list', projectId: string = '', projectName: string = '') {
    // Store the current mode as previous before changing
    previousMode.value = currentMode.value;
    
    initialProjectName.value = projectName;
    currentMode.value = openMode;
    currentProjectId.value = projectId;
    isVisible.value = true;
}

function closeProjectManager() {
    console.log('Closing project manager dialog');
    isVisible.value = false;
    initialProjectName.value = '';
    // No need to change the route anymore
}

// Export the composable
export function useProjectManagerDialog() {
    return {
        isVisible,
        initialProjectName,
        currentMode,
        previousMode,
        currentProjectId,
        openProjectManager,
        closeProjectManager
    };
}