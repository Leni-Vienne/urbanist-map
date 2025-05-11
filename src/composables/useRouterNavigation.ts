import { ref } from 'vue';
import { router } from '../router';

// AI: State accessible without requiring router injection
export const initialProjectName = ref<string>('');
export const lastCreatedProjectId = ref<string | null>(null);

/**
 * AI: Simple back navigation with safety check
 */
export function goBack(closeDialog?: any) {
  // AI: Close dialog if provided
  if (closeDialog && typeof closeDialog === 'object' && 'value' in closeDialog) {
    closeDialog.value = false;
  }
  
  // AI: Safe navigation with fallback to home
  if (window.history.length > 2 && router.options?.history?.state?.back) {
    router.back();
  } else {
    router.push('/');
  }
}

/**
 * AI: Open project manager view
 */
export function openProjectManager(mode = 'list', projectId = '', projectName = '') {
  initialProjectName.value = projectName;
  
  switch (mode) {
    case 'create': router.push('/projects/create'); break;
    case 'edit': router.push(projectId ? `/projects/${projectId}/edit` : '/projects'); break;
    case 'view': router.push(projectId ? `/projects/${projectId}` : '/projects'); break;
    default: router.push('/projects');
  }
}

/**
 * AI: Navigate directly to project edit page
 */
export function navigateToProjectEdit(projectId: string) {
  if (!projectId) return;
  router.push(`/projects/${projectId}/edit`);
}

/**
 * AI: Store the ID of the newly created project
 */
export function setLastCreatedProject(projectId: string | null) {
  lastCreatedProjectId.value = projectId;
}