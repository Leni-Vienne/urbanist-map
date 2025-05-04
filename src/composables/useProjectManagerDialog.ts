import { ref } from 'vue';

export type ProjectManagerMode = 'list' | 'edit' | 'view' | 'create';

// Dialog visibility state
const isVisible = ref(false);
const initialProjectName = ref('');
const currentMode = ref<ProjectManagerMode>('list');
const previousMode = ref<ProjectManagerMode | null>(null);
const currentProjectId = ref<string>('');
// AI : Track if we're creating a new project from the project list
const creatingFromList = ref(false);

// Functions to control the dialog
function openProjectManager(openMode: ProjectManagerMode = 'list', projectId: string = '', projectName: string = '') {
    // Store the current mode as previous before changing
    previousMode.value = currentMode.value;
    
    // AI : If opening create mode from list mode, track this state
    if (openMode === 'create' && currentMode.value === 'list') {
        creatingFromList.value = true;
    }
    
    initialProjectName.value = projectName;
    currentMode.value = openMode;
    currentProjectId.value = projectId;
    isVisible.value = true;
}

function closeProjectManager() {
    console.log('Closing project manager dialog');
    
    // AI : If we're closing a "create" dialog that was opened from the list,
    // don't actually close the dialog but return to list mode
    if (currentMode.value === 'create' && creatingFromList.value) {
        currentMode.value = 'list';
        creatingFromList.value = false; // Reset the flag
        return; // Don't close the dialog
    }
    
    isVisible.value = false;
    initialProjectName.value = '';
    // Reset the creation flag when actually closing
    creatingFromList.value = false;
}

// Export the composable
export function useProjectManagerDialog() {
    return {
        isVisible,
        initialProjectName,
        currentMode,
        previousMode,
        currentProjectId,
        creatingFromList,
        openProjectManager,
        closeProjectManager
    };
}