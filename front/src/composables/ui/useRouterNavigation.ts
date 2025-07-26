import { ref } from 'vue';
import { router } from '../../router';

// AI: State accessible without requiring router injection
export const initialProjectName = ref<string>('');
export const lastCreatedProjectId = ref<string | null>(null);
export const inFileUploadFlow = ref<boolean>(false);

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
    navigateWithCoordinates('/');
  }
}

// AI: Navigate while preserving map coordinates
export function navigateWithCoordinates(path: string) {
  const url = new URL(window.location.href);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const zoom = url.searchParams.get('zoom');
  
  const query: Record<string, string> = {};
  if (lat) query.lat = lat;
  if (lng) query.lng = lng;
  if (zoom) query.zoom = zoom;
  
  router.push({ path, query });
}

/**
 * AI: Open project manager view
 */
export function openProjectManager(mode = 'list', projectId = '', projectName = '') {
  initialProjectName.value = projectName;
  
  let path = '/projects';
  switch (mode) {
    case 'create': path = '/projects/create'; break;
    case 'edit': path = projectId ? `/projects/${projectId}/edit` : '/projects'; break;
    case 'view': path = projectId ? `/projects/${projectId}` : '/projects'; break;
  }
  navigateWithCoordinates(path);
}

/**
 * AI: Navigate directly to project edit page
 */
export function navigateToProjectEdit(projectId: string) {
  if (!projectId) return;
  navigateWithCoordinates(`/projects/${projectId}/edit`);
}

/**
 * AI: Store the ID of the newly created project
 */
export function setLastCreatedProject(projectId: string | null) {
  lastCreatedProjectId.value = projectId;
}

/**
 * AI: Set the file upload flow state for navigation context
 */
export function setFileUploadFlow(active: boolean): void {
  inFileUploadFlow.value = active;
}