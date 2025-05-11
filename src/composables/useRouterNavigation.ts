// filepath: d:\Documents\Perso\prog\city-map-overlay\src\composables\useRouterNavigation.ts
import { ref } from 'vue';
import { useRouter, Router } from 'vue-router';

/**
 * AI : Simple navigation composable with minimal code
 */
export function useRouterNavigation(externalRouter?: Router) {
  // AI : Get router from injection or external parameter
  let router: Router | undefined;
  
  try {
    router = useRouter();
  } catch (e) {
    router = externalRouter;
  }
  
  // AI : Minimal state - just what we need
  const initialProjectName = ref<string>('');
  const lastCreatedProjectId = ref<string | null>(null);
  
  /**
   * AI : Simple back navigation with safety check
   */
  function goBack(closeDialog?: any) {
    console.log('goBack', closeDialog);
    if (!router) return;
    
    // AI : Close dialog if provided
    if (closeDialog && typeof closeDialog === 'object' && 'value' in closeDialog) {
      closeDialog.value = false;
    }
    
    // AI : Safe navigation with fallback to home
    if (window.history.length > 2 && router.options?.history?.state?.back) {
      router.back();
    } else {
      router.push('/');
    }
  }
  
  /**
   * AI : Open project manager view
   */
  function openProjectManager(mode = 'list', projectId = '', projectName = '') {
    if (!router) return;
    initialProjectName.value = projectName;
    
    switch (mode) {
      case 'create': router.push('/projects/create'); break;
      case 'edit': router.push(projectId ? `/projects/${projectId}/edit` : '/projects'); break;
      case 'view': router.push(projectId ? `/projects/${projectId}` : '/projects'); break;
      default: router.push('/projects');
    }
  }
  
  /**
   * AI : Store the ID of the newly created project
   */
  function setLastCreatedProject(projectId: string | null) {
    lastCreatedProjectId.value = projectId;
  }
  
  return {
    goBack,
    openProjectManager,
    setLastCreatedProject,
    lastCreatedProjectId,
    initialProjectName
  };
}