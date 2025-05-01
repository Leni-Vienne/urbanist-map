import { ref } from 'vue';

export type ProjectManagerMode = 'list' | 'edit' | 'view' | 'create';

// Dialog visibility state
const isVisible = ref(false);
const initialProjectName = ref('');
const currentMode = ref<ProjectManagerMode>('list');
const currentProjectId = ref<string>('');

// Functions to control the dialog
function openProjectManager(openMode: ProjectManagerMode = 'list', projectId: string = '', projectName: string = '') {
    initialProjectName.value = projectName;
    currentMode.value = openMode;
    currentProjectId.value = projectId;
    isVisible.value = true;
}

function closeProjectManager() {
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
        currentProjectId,
        openProjectManager,
        closeProjectManager
    };
}