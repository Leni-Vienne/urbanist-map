import { ref } from 'vue';
import { router } from '../../router';

// AI: State accessible without requiring router injection
const lastCreatedProjectId = ref<string | null>(null);
const inFileUploadFlow = ref<boolean>(false);

// AI: Export as named exports to prevent tree-shaking issues
export { lastCreatedProjectId, inFileUploadFlow };

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
export function openProjectManager(mode = 'list', projectId = '') {
  
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