<template>
  <div class="app-container">
    <SideMenu
      :is-open="sideMenuOpen"
      :is-moderator="isModerator"
      @close="handleSideMenuClose"
    />
    <div class="main-content">
      <button
        v-if="authStore.isAuthenticated"
        class="menu-toggle-button"
        @click="sideMenuOpen = !sideMenuOpen"
      >
        <i class="pi pi-bars" />
      </button>
      <Toast />

      <!-- AI : Map is always present in the background -->
      <MapView />

      <!-- AI : InfoPopup with teleport mechanism -->
      <InfoPopupContainer />
    </div>

    <!-- AI : Global Dialog Components -->
    <Dialog
      v-model:visible="uiStore.projectSelectorVisible"
      header="Select a nearby project for the new overlay"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <ProjectPicker
        @project-selected="onProjectSelected"
        @create-project="uiStore.openProjectDialog()"
        @select-focus="fetchProjectsForPicker"
        :useCityProjects="true"
        ref="projectPickerRef"
      />
    </Dialog>

    <ProjectDialog
      v-if="uiStore.projectDialog.visible"
      v-model:visible="uiStore.projectDialog.visible"
      :project="uiStore.projectDialog.project ?? {}"
      :mode="uiStore.projectDialog.mode"
      :title="uiStore.projectDialog.mode === 'create' ? 'Create New Project' : 'Edit Project'"
      @submit="handleProjectSubmitted"
      @cancel="uiStore.closeProjectDialog"
    />

    <!-- AI : Edit forms dialogs with proper modal behavior -->
    <Dialog
      v-model:visible="uiStore.projectEditForm.visible"
      :modal="true"
      :closable="true"
      :draggable="false"
      header="Suggest Project Changes"
      @update:visible="uiStore.closeProjectEditForm"
      class="edit-form-dialog"
    >
      <EditableProjectForm
        v-if="uiStore.projectEditForm.data && uiStore.projectEditForm.visible"
        :project="(uiStore.projectEditForm.data as Project)"
        @close="uiStore.closeProjectEditForm"
        @submitted="uiStore.closeProjectEditForm"
      />
    </Dialog>

    <Dialog
      v-model:visible="uiStore.overlayEditForm.visible"
      :modal="true"
      :closable="true"
      :draggable="false"
      header="Suggest Overlay Changes"
      @update:visible="uiStore.closeOverlayEditForm"
      class="edit-form-dialog"
    >
      <EditableOverlayForm
        v-if="uiStore.overlayEditForm.data && uiStore.overlayEditForm.visible"
        :overlay="(uiStore.overlayEditForm.data as OverlayObject)"
        @close="uiStore.closeOverlayEditForm"
        @submitted="uiStore.closeOverlayEditForm"
      />
    </Dialog>

    <ImageUploadDialog
      v-model:visible="uiStore.imageUploadDialogVisible"
      @file-selected="onImageUploadFromDialog"
    />

    <!-- AI : Auth Modal for unauthenticated users -->
    <AuthModal v-model:visible="uiStore.authModalVisible" />
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import 'leaflet-toolbar/dist/leaflet.toolbar.css'
import 'leaflet-distortableimage/dist/leaflet.distortableimage.css'
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { onMounted, ref, onUnmounted, defineAsyncComponent } from 'vue'
import MapView from '@components/map/MapView.vue'
import SideMenu from '@components/layout/SideMenu.vue'
import InfoPopupContainer from '@components/map/InfoPopupContainer.vue'
import ImageUploadDialog from '@components/dialogs/ImageUploadDialog.vue'
import AuthModal from '@components/auth/AuthModal.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { initializeStores } from '@composables/overlay/useOverlay'
import { useBeforeUnload } from '@composables/core/useBeforeUnload'
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects'
import { addOverlay } from '@composables/overlay/useOverlayActions'
import { setLastCreatedProject } from '@composables/ui/useProjectState'
import { createProject } from '@composables/project/useProjects'
import { storeToRefs } from 'pinia'
import type { Project, OverlayObject } from '@types'

const ProjectPicker = defineAsyncComponent(() => import('@components/project/ProjectPicker.vue'));
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'));
const EditableProjectForm = defineAsyncComponent(() => import('@components/forms/EditableProjectForm.vue'));
const EditableOverlayForm = defineAsyncComponent(() => import('@components/forms/EditableOverlayForm.vue'));

// AI : Create refs to track app state
const isModerator = ref(false)
const sideMenuOpen = ref(true) // AI : Open by default
const currentPanelType = ref<'explorer' | 'moderation'>('explorer') // AI : Default to explorer
const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const authStore = useAuthStore()
const uiStore = useUiStore()
const toast = useToast()
const projectPickerRef = ref()

const { projects } = storeToRefs(projectStore);
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore);

// AI : Initialize beforeunload handler for modified overlays
useBeforeUnload()

// AI : Handle window visibility change to close UI elements when user switches tabs/apps
function handleVisibilityChange() {
  // AI : Only close dialogs when the page becomes hidden (user switched tabs/minimized window)
  // AI : This is more reliable than blur events and doesn't interfere with native dialogs
  if (document.hidden) {
    // AI : Don't close if we're in the middle of critical user flows
    if (!pendingImageFile.value && !uiStore.imageUploadDialogVisible && !uiStore.projectSelectorVisible) {
      overlayStore.closeAllUIElements();
    }
  }
}

// AI : Handle side menu close (mobile only)
function handleSideMenuClose() {
  sideMenuOpen.value = false;
}

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : Check if project exists in local store, if not, try to get it from nearby projects
  if (!projects.value[projectId]) {
    try {
      // AI : Fetch nearby projects to get the selected project data
      const nearbyProjects = await fetchNearbyProjects();
      const nearbyProject = nearbyProjects.find((p: any) => p.id === projectId);

      if (nearbyProject) {
        // AI : Convert nearby project to local project format and add to store
        const localProject = {
          id: nearbyProject.id,
          name: nearbyProject.name,
          description: nearbyProject.description ?? '',
          overlayIds: [],
          color: '#007bff',
          cityId: nearbyProject.cityId,
          status: 'approved' as const,
          ownerId: nearbyProject.ownerId,
          createdAt: nearbyProject.createdAt,
          updatedAt: nearbyProject.updatedAt,
          metadata: nearbyProject.metadata,
          city: nearbyProject.city ? {
            id: nearbyProject.city.id,
            name: nearbyProject.city.name,
            countryCode: nearbyProject.city.countryCode,
            coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
            createdAt: null,
            updatedAt: new Date()
          } : undefined,
          sourceUrl: null,
          startDate: null,
          endDate: null,
          latestUpdateOn: null,
          savedRemotely: true
        };

        // AI : Add project to local store
        projects.value[projectId] = localProject;
      } else {
        console.warn('AI : Project not found in nearby projects, overlay creation may not work properly');
      }
    } catch (error) {
      console.error('AI : Error fetching nearby projects for project selection:', error);
    }
  }

  await handleFileUpload(projectId, !!replacementOverlayId.value);
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement: boolean = false) {
  if (!pendingImageFile.value) {
    console.warn('No image file to upload');
    toast.add({
      severity: 'warn',
      summary: 'No file selected',
      detail: 'Please select an image file to upload',
      life: 3000
    });
    uiStore.closeProjectSelector();
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      if (isReplacement && replacementOverlayId.value) {
        // AI : Create replacement overlay using the standard overlay creation process
        const overlayId = await addOverlay(reader.result as string, projectId, replacementOverlayId.value);

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: 'Replacement Overlay Created',
            detail: 'Your replacement overlay has been created and is ready for editing',
            life: 3000
          });
        }
      } else {
        // AI : Regular overlay addition
        await addOverlay(reader.result as string, projectId);
        // AI : Don't show toast here - addOverlayToProjectWithId will show a more specific toast
      }
    } catch (error) {
      console.error('Error handling file upload:', error);
      toast.add({
        severity: 'error',
        summary: 'Upload Failed',
        detail: 'Failed to process the image overlay',
        life: 3000
      });
    } finally {
      // AI : Reset state
      overlayStore.resetReplacement();
      uiStore.closeProjectSelector();
    }
  };
  reader.readAsDataURL(pendingImageFile.value);
}

// AI : Handle file selection from dialog
async function onImageUploadFromDialog(file: File) {
  overlayStore.handleFileSelected(file);
  // AI : Show project selector for overlay workflow
  uiStore.openProjectSelector();
}

// AI : Fetch projects for picker when dropdown is focused
async function fetchProjectsForPicker() {
  try {
    // AI : Fetch nearby projects based on current map view
    await fetchNearbyProjects();
  } catch (error) {
    console.error('Error fetching projects for picker:', error);
  }
}

// AI : Handle project creation/update from dialog
async function handleProjectSubmitted(project: any) {
  uiStore.closeProjectDialog();
  
  // AI : Create the project in the store if it doesn't already have an ID
  if (project && !project.id) {
    try {
      // AI : Create the project and get the generated ID
      const projectId = await createProject(project);
      setLastCreatedProject(projectId);
      
      // AI : Re-open the project selector so the ProjectPicker can auto-select the new project
      // AI : and continue with the file upload workflow
      if (pendingImageFile.value) {
        uiStore.openProjectSelector();
      }
    } catch (error) {
      console.error('Error creating project:', error);
      toast.add({
        severity: 'error',
        summary: 'Project Creation Failed',
        detail: 'Failed to create the project. Please try again.',
        life: 3000
      });
    }
  } else if (project && project.id) {
    // AI : Project already exists (edit mode), just set it as last created for consistency
    setLastCreatedProject(project.id);
    
    if (pendingImageFile.value) {
      uiStore.openProjectSelector();
    }
  }
}

onMounted(async () => {
  // AI : Initialize stores first
  initializeStores();

  if (import.meta.env.VITE_DEV_MODE === 'true') {
    isModerator.value = true
  }

  // AI : Add visibility change listener to close UI elements when user switches tabs/apps
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // AI : Update overlayStore to use the new UI store for dialog control
  overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

  try {
    // AI : Initialize Supabase authentication
    await authStore.initialize()
    
    // AI : Check if user is a moderator based on their role in Supabase
    if (authStore.user?.user_metadata?.role === 'admin') {
      isModerator.value = true
    }

    // AI : Handle auth query parameters from URL
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('auth') === 'success') {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Successfully signed in!',
        life: 3000
      })
    } else if (urlParams.get('error')) {
      const errorMessage = getErrorMessage(urlParams.get('error') as string)
      toast.add({
        severity: 'error',
        summary: 'Authentication Error',
        detail: errorMessage,
        life: 5000
      })
    }
  }
  catch (error) {
    console.error('Error during application initialization:', error)
  }
})

// AI : Get user-friendly error messages
function getErrorMessage(error: string): string {
  switch (error) {
    case 'auth_failed':
      return 'Authentication failed. Please try again.'
    case 'no_session':
      return 'Sign in was cancelled or failed.'
    case 'unexpected':
      return 'An unexpected error occurred during sign in.'
    default:
      return 'Authentication error occurred.'
  }
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
})
</script>

<style>
.app-container {
  display: flex;
  height: 100vh;
}

.main-content {
  flex-grow: 1;
  position: relative;
}

/* AI : Transition effects for route changes */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.menu-toggle-button {
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 1001;
  background-color: var(--p-surface-50);
  border: 1px solid #dee2e6;
  border-radius: 0.25rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.menu-toggle-button:hover {
  background-color: var(--p-surface-100);
  transform: scale(1.05);
}

/* AI : Hide toggle button on desktop when side menu is open */
@media (min-width: 769px) {
  .menu-toggle-button {
    display: none;
  }
}

/* AI : Show toggle button on mobile */
@media (max-width: 768px) {
  .menu-toggle-button {
    display: flex;
  }
}

/* AI : Edit form dialogs - ensure proper modal behavior */
:deep(.edit-form-dialog .p-dialog) {
  max-width: 90vw;
  max-height: 90vh;
  z-index: 9999;
}

:deep(.edit-form-dialog .p-dialog-content) {
  padding: 0;
}

:deep(.edit-form-dialog .p-dialog-mask) {
  z-index: 9998;
}
</style>
