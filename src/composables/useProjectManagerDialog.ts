import { ref } from 'vue';

export type ProjectManagerMode = 'list' | 'edit' | 'view' | 'create';
export type OriginContext = 'list' | 'picker' | 'other';

// Dialog visibility state
const isVisible = ref(false);
const initialProjectName = ref('');
const currentMode = ref<ProjectManagerMode>('list');
const previousMode = ref<ProjectManagerMode | null>(null);
const currentProjectId = ref<string>('');
// AI : Track the origin context to know where to return after operations
const originContext = ref<OriginContext>('other');
// AI : Track the ID of the newly created project for auto-selection
const lastCreatedProjectId = ref<string | null>(null);
// AI : Track if we're in the file upload flow
const inFileUploadFlow = ref(false);

// Functions to control the dialog
function openProjectManager(openMode: ProjectManagerMode = 'list', projectId: string = '', projectName: string = '', context: OriginContext = 'other') {
    // Store the current mode as previous before changing
    previousMode.value = currentMode.value;
    
    // AI : Store the origin context to know where to return
    originContext.value = context;
    
    initialProjectName.value = projectName;
    currentMode.value = openMode;
    currentProjectId.value = projectId;
    isVisible.value = true;
}

function closeProjectManager() {
    console.log('Closing project manager dialog', { 
        currentMode: currentMode.value, 
        originContext: originContext.value 
    });
    
    // AI : If we're closing a "create" dialog, determine where to return based on origin
    if (currentMode.value === 'create') {
        if (originContext.value === 'list') {
            // AI : Return to list mode if we came from list
            currentMode.value = 'list';
            return; // Don't close the dialog
        } else if (originContext.value === 'picker' && inFileUploadFlow.value) {
            // AI : If we came from picker during file upload, we should close and return to picker
            isVisible.value = false;
            return;
        }
    }
    
    // AI : Default behavior: just close the dialog
    isVisible.value = false;
    initialProjectName.value = '';
    // AI : Reset all context tracking when fully closing
    originContext.value = 'other';
}

// AI : Set the file upload flow state
function setFileUploadFlow(active: boolean): void {
    inFileUploadFlow.value = active;
}

// AI : Set the ID of the newly created project
function setLastCreatedProject(projectId: string | null): void {
    lastCreatedProjectId.value = projectId;
}

// Export the composable
export function useProjectManagerDialog() {
    return {
        isVisible,
        initialProjectName,
        currentMode,
        previousMode,
        currentProjectId,
        originContext,
        inFileUploadFlow,
        lastCreatedProjectId,
        openProjectManager,
        closeProjectManager,
        setFileUploadFlow,
        setLastCreatedProject
    };
}