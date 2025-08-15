import { ref } from 'vue';

// AI: State management for project creation flow
const lastCreatedProjectId = ref<string | null>(null);
const inFileUploadFlow = ref<boolean>(false);

// AI: Export as named exports to prevent tree-shaking issues
export { lastCreatedProjectId, inFileUploadFlow };

/**
 * AI: Store the ID of the newly created project
 */
export function setLastCreatedProject(projectId: string | null) {
  lastCreatedProjectId.value = projectId;
}

/**
 * AI: Set the file upload flow state for tracking context
 */
export function setFileUploadFlow(active: boolean): void {
  inFileUploadFlow.value = active;
}