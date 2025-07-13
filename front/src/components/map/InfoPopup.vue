<template>
  <div class="info-popup">
    <div
      v-if="loading"
      class="loading-spinner"
    >
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div
      v-else
      class="project-details"
    > <!-- Project Selection Section - Only visible in edit mode -->
      <div
        v-if="!props.viewMode"
        class="project-selection mb-3"
      >
        <div class="text-sm font-semibold mb-2 text-gray-700">Project Assignment</div>
        <ProjectPicker
          v-model="projectPickerValue"
          @project-selected="applyProjectChange"
          @select-focus="onProjectPickerSelectFocus"
          :hideSelector="false"
          :placeholder="project ? 'Change project' : 'Select a project'"
        />
      </div>

      <!-- Project Information Section -->
      <div
        v-if="project"
        class="project-meta mb-3"
      >
        <div class="text-sm font-semibold mb-2 text-gray-700 flex justify-between items-center">
          Project Information
          <Button
            v-if="!props.viewMode"
            icon="pi pi-pencil"
            class="p-button-sm p-button-text p-button-info"
            @click="openProjectManagerForEdit"
            v-tooltip.top="'Edit Project'"
          />
        </div>
        <div class="p-2 rounded bg-gray-50 text-sm space-y-1">
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Name:</span>
            <span class="text-right">{{ project.title ?? 'Not specified' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Location:</span>
            <span class="text-right">{{ getProjectLocationDisplay(project) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Period:</span>
            <span class="text-right text-xs">
              <span v-if="!project.startDate && !project.endDate">Not specified</span>
              
              <span v-else>
                {{ formatDate(project.startDate) }} - {{ project.endDate ? formatDate(project.endDate) : 'Present' }}
              </span>
            </span>
          </div>
          <div
            v-if="project.sourceUrl"
            class="flex justify-between"
          >
            <span class="font-medium text-gray-600">Source:</span>
            <a
              :href="project.sourceUrl"
              target="_blank"
              class="text-blue-600 hover:underline text-xs truncate max-w-32"
            >{{ project.sourceUrl }}</a>
          </div>
          <div
            v-if="project.latestUpdateOn"
            class="flex justify-between"
          >
            <span class="font-medium text-gray-600">Latest Update:</span>
            <span class="text-right text-xs">{{ formatDate(project.latestUpdateOn) }}</span>
          </div>
        </div>
      </div>

      <!-- Overlay Information Section -->
      <div class="overlay-meta mb-3">
        <div class="text-sm font-semibold mb-2 text-gray-700 flex justify-between items-center">
          Overlay Information
          <Button
            v-if="!props.viewMode"
            icon="pi pi-pencil"
            class="p-button-sm p-button-text p-button-info"
            @click="openOverlayEditor"
            v-tooltip.top="'Edit Overlay'"
          />
        </div>
        <div class="p-2 rounded bg-gray-50 text-sm space-y-1">
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Name:</span>
            <span class="text-right">{{ currentOverlay.caption ?? 'Not specified' }}</span>
          </div>
        </div>
        <OverlayEditor
          ref="overlayEditorRef"
          :overlayObject="currentOverlay"
          @update="onOverlayUpdate"
        />
      </div>
    </div> <!-- Publish Overlay Section -->
    <div
      v-if="!props.viewMode && project"
      class="publish-section"
    >

      <Button
        label="Publish Overlay"
        icon="pi pi-cloud-upload"
        class="p-button-success p-button-sm w-full"
        :loading="isPublishing"
        @click="publishOverlay"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';

import { useToast } from '@composables/ui/useToast';
import { updateTooltipText } from '@composables/overlay/useOverlayActions';
import { projects, addOverlayToProjectWithId, removeOverlayFromProjectWithId } from '@stores/projectStore';
import { overlays } from '@stores/overlayStore';
import { navigateToProjectEdit } from '@composables/ui/useRouterNavigation';
import { loadCityProjects, citiesWithProjects, latestClickedCity } from '@composables/map/useCityMarkers';
import { getNearbyProjects } from '@composables/project/useNearbyProjects';
import ProjectPicker from '@components/project/ProjectPicker.vue';
import OverlayEditor from '@components/map/OverlayEditor.vue';
import type { OverlayObject, Project } from '@types';
import { trpc } from '@client'

const props = defineProps<{
  overlayObject: OverlayObject;
  onProjectSubmit?: (data: any) => void;
  viewMode?: boolean;
}>();

const toast = useToast();
const loading = ref(true);
const selectedProjectId = ref<string | null>(null);
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);
const isPublishing = ref(false);

// AI : Use a reactive reference for the current project ID to ensure reactivity
const currentProjectId = ref<string | null>(null);

// AI : Get the current overlay from the store to ensure we have the latest data
const currentOverlay = computed(() => {
  return overlays.value[props.overlayObject.id] || props.overlayObject;
});

// AI : Computed property to handle null/undefined conversion for ProjectPicker v-model
const projectPickerValue = computed({
  get: () => selectedProjectId.value ?? '',
  set: (value: string) => {
    selectedProjectId.value = value ?? null;
  }
});

// AI : Make project reactive to changes in projects store and currentProjectId
const project = computed(() => {
  if (currentProjectId.value) {
    // AI : First try to get from local projects store (for edit mode and local overlays)
    const localProject = projects.value[currentProjectId.value];
    if (localProject) {
      return localProject;
    }

    // AI : If not found locally, check if this overlay has backend project data (for view mode)
    if (currentOverlay.value.project && currentOverlay.value.project.id === currentProjectId.value) {
      // AI : Convert backend project data to frontend format
      const backendProject = currentOverlay.value.project;
      const convertedProject: Project = {
        ...backendProject,
        name: backendProject.title, // AI : Map title to name for frontend compatibility
        city: backendProject.city as any, // AI : Cast city to any to satisfy Project type
        overlayIds: [],
        color: '#007bff'
      };
      
      // AI : Add the project to the projects store so ProjectPicker can access it
      if (!projects.value[currentProjectId.value]) {
        projects.value = {
          ...projects.value,
          [currentProjectId.value]: convertedProject
        };
      }
      
      return convertedProject;
    }
  }
  return null;
});

// AI : Watch for changes in the current overlay's projectId to update both selectedProjectId and currentProjectId
watch(() => currentOverlay.value.projectId, (newProjectId) => {
  selectedProjectId.value = newProjectId;
  currentProjectId.value = newProjectId;
}, { immediate: true });

// AI : Initialize component
onMounted(async () => {
  // AI : Initialize the reactive state with the initial overlay data
  selectedProjectId.value = currentOverlay.value.projectId;
  currentProjectId.value = currentOverlay.value.projectId;
  loading.value = false;
});

// AI : Format date for display
function formatDate(date: Date | null): string {
  if (!date) return 'Not specified';
  return new Date(date).toLocaleDateString();
}

// AI : Handle overlay update from the OverlayEditor component
function onOverlayUpdate(overlayId: string, caption?: string) {
  // AI : Update the local data if needed
  if (overlayId === currentOverlay.value.id) {
    currentOverlay.value.caption = caption ?? null;
  }
}

// AI : Get display text for project location (city name or fallback)
function getProjectLocationDisplay(project: Project): string {
  // AI : First check if project has city data directly
  if (project.city?.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }
  
  // AI : If no direct city data, look up city by cityId in citiesWithProjects
  if (project.cityId) {
    const city = citiesWithProjects.value.find(c => c.id === project.cityId);
    if (city) {
      return `${city.name}, ${city.countryCode}`;
    }
  }
  
  // AI : If still no city found, use the latest clicked city if it matches the project's cityId
  if (project.cityId && latestClickedCity && latestClickedCity.id === project.cityId) {
    return latestClickedCity.countryCode 
      ? `${latestClickedCity.name}, ${latestClickedCity.countryCode}`
      : latestClickedCity.name;
  }
  
  return 'Not specified';
}

// AI : Apply project change to overlay
async function applyProjectChange(projectId: string) {
  try {
    const originalProjectId = currentOverlay.value.projectId;

    // AI : If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await removeOverlayFromProjectWithId(originalProjectId, currentOverlay.value.id);
    }

    // AI : Check if project exists in local store, if not, try to get it from nearby projects
    if (!projects.value[projectId]) {
      // AI : Get nearby projects to find the selected project
      const { projects: nearbyProjectsData } = getNearbyProjects();
      const nearbyProject = nearbyProjectsData.value.find((p: any) => p.id === projectId);
      
      if (nearbyProject) {
        // AI : Convert nearby project to local project format and add to store
        const localProject = {
          id: nearbyProject.id,
          name: nearbyProject.title,
          title: nearbyProject.title,
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
        
        // AI : Also set project data on overlay object for InfoPopup display - convert to compatible format
        currentOverlay.value.project = {
          id: nearbyProject.id,
          status: 'approved' as const,
          title: nearbyProject.title,
          description: nearbyProject.description ?? null,
          createdAt: nearbyProject.createdAt,
          updatedAt: nearbyProject.updatedAt,
          ownerId: nearbyProject.ownerId,
          cityId: nearbyProject.cityId,
          startDate: null, // AI : Not available in nearby projects
          endDate: null, // AI : Not available in nearby projects
          sourceUrl: null, // AI : Not available in nearby projects
          latestUpdateOn: null, // AI : Not available in nearby projects
          metadata: nearbyProject.metadata,
          city: nearbyProject.city ? {
            id: nearbyProject.city.id,
            name: nearbyProject.city.name,
            countryCode: nearbyProject.city.countryCode,
            coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
            createdAt: null,
            updatedAt: new Date()
          } : null
        };
      } else {
        // AI : Project not found in nearby projects, show error
        throw new Error(`Project ${projectId} not found in local store or nearby projects`);
      }
    }

    // AI : Add to the new project
    await addOverlayToProjectWithId(projectId, currentOverlay.value.id);

    // AI : Update local state - both the prop and reactive references
    currentOverlay.value.projectId = projectId;
    currentProjectId.value = projectId;
    selectedProjectId.value = projectId;

    // AI : Force reactivity update by triggering a nextTick
    await nextTick();

    toast.add({
      severity: 'success',
      summary: 'Project Updated',
      detail: 'Overlay assigned to project successfully',
      life: 3000
    });

    // AI : Update the tooltip text
    updateTooltipText();
  } catch (error) {
    console.error('AI : Failed to assign overlay to project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to assign overlay to project',
      life: 3000
    });
  }
}

// AI : Open project manager for edit
function openProjectManagerForEdit() {
  if (!project.value) return;

  // AI : Store the project ID first
  const projectId = project.value.id;

  // AI : Navigate to project edit page using composable
  navigateToProjectEdit(projectId);
}

// AI : Open the overlay editor dialog
function openOverlayEditor() {
  overlayEditorRef.value?.openDialog();
}

// AI : Helper function to convert data URL to WebP if needed
async function convertToWebPIfNeeded(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // AI : If already WebP, return as is
  if (blob.type === 'image/webp') {
    return new File([blob], filename.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' });
  }

  // AI : Convert to WebP
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      ctx.drawImage(img, 0, 0)

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to convert image to WebP'))
          return
        }

        const webpFilename = filename.replace(/\.[^/.]+$/, '.webp')
        const file = new File([blob], webpFilename, { type: 'image/webp' })
        resolve(file)
      }, 'image/webp', 1.0)
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

function getCornersFromOverlay(overlay: OverlayObject) {
  if (overlay.overlay) {
    return overlay.overlay.getCorners();
  }
  return [
    { lat: overlay.topLeftLat, lng: overlay.topLeftLng },
    { lat: overlay.topRightLat, lng: overlay.topRightLng },
    { lat: overlay.bottomRightLat, lng: overlay.bottomRightLng },
    { lat: overlay.bottomLeftLat, lng: overlay.bottomLeftLng },
  ];
}

// AI : Validate if overlay can be published
function validateOverlayForPublishing(): boolean {
  if (!project.value) {
    toast.add({
      severity: 'error',
      summary: 'Cannot Publish',
      detail: 'Overlay must be assigned to a project',
      life: 3000
    });
    return false;
  }

  const corners = getCornersFromOverlay(currentOverlay.value);
  if (!corners || corners.length !== 4 || corners.some(c => !c.lat || !c.lng)) {
    toast.add({
      severity: 'error',
      summary: 'Cannot Publish',
      detail: 'Overlay must have valid position (4 corners)',
      life: 3000
    });
    return false;
  }
  return true;
}

// AI : Ensure project exists on server and handle project publishing
async function ensureProjectOnServer(): Promise<boolean> {
  if (!project.value) {
    return false;
  }

  try {
    const projectResult = await trpc.project.publishProject.mutate({
      id: project.value.id,
      title: project.value.title,
      description: project.value.description ?? undefined,
      cityId: project.value.cityId ?? undefined,
      startDate: project.value.startDate?.toISOString(),
      endDate: project.value.endDate?.toISOString(),
      sourceUrl: project.value.sourceUrl ?? undefined,
      latestUpdateOn: project.value.latestUpdateOn?.toISOString()
    });
    if (!projectResult.success) {
      throw new Error('Failed to publish project to server');
    }

    // AI : Handle project ID update and IndexedDB cleanup if this is a new project
    if (projectResult.success && projectResult.id) {
      const oldProjectId = project.value.id;

      // AI : If this is a new project (not existing), update the project ID
      if (!projectResult.exists && projectResult.id !== oldProjectId && project.value) {
        // AI : Update the project ID with the one from the backend
        project.value.id = projectResult.id;

        // AI : Update project ID in the projects store
        const updatedProjects = { ...projects.value };
        delete updatedProjects[oldProjectId];
        updatedProjects[projectResult.id] = project.value;
        projects.value = updatedProjects;

        // AI : Update current project ID references
        currentProjectId.value = projectResult.id;

        // AI : Update overlay's project reference
        currentOverlay.value.projectId = projectResult.id;

        // AI : Delete the old project from local memory
        console.log('AI : Project ID updated, removing old project from memory:', oldProjectId);
      }
    }
    
    // AI : Show appropriate message
    const actionText = projectResult.exists ? 'updated on' : 'saved to';
    if (!projectResult.exists) {
      toast.add({
        severity: 'info',
        summary: 'Project Published',
        detail: `Project has been ${actionText} the server database`,
        life: 2000
      });
    }
    return true;
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Project Publish Failed',
      detail: `Failed to publish project "${project.value.title}" to server: ${error instanceof Error ? error.message : String(error)}`,
      life: 5000
    });
    throw error;
  }
}

// AI : Prepare image for server (upload or extract filename)
async function prepareImageForServer(): Promise<string> {
  if (currentOverlay.value.imageUrl.startsWith('data:')) {
    // AI : Convert data URL to WebP if needed and upload
    const imageFile = await convertToWebPIfNeeded(currentOverlay.value.imageUrl, `overlay-${currentOverlay.value.id}.webp`);

    const formData = new FormData();
    formData.append('image', imageFile);

    const uploadResponse = await fetch('http://localhost:3000/api/upload-image', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image to server');
    }
    const uploadResult = await uploadResponse.json();

    return uploadResult.filename;
  } else {
    // AI : Extract filename from existing server URL
    const urlParts = currentOverlay.value.imageUrl.split('/');
    return urlParts[urlParts.length - 1];
  }
}

// AI : Publish overlay metadata to server
async function publishOverlayToServer(filename: string): Promise<{ success: boolean; exists: boolean; id?: string }> {
  const corners = getCornersFromOverlay(currentOverlay.value);
  const payload = {
    id: currentOverlay.value.id,
    filename: filename,
    caption: currentOverlay.value.caption ?? undefined,
    projectId: currentOverlay.value.projectId!,
    metadata: {
      // AI : Keep metadata empty as requested - no caption or history data
    },
    corners: corners.map(c => ({ lat: c.lat, lng: c.lng })),
  };

  const overlayResult = await trpc.overlay.publishOverlay.mutate(payload);

  if (overlayResult.success) {
    const actionText = overlayResult.exists ? 'updated on' : 'saved to';
    toast.add({
      severity: 'success',
      summary: 'Overlay Published',
      detail: `Overlay has been ${actionText} the server database`,
      life: 3000
    });
    return { success: true, exists: overlayResult.exists, id: overlayResult.id };
  }

  return { success: false, exists: false };
}

// AI : Publish overlay to server database
async function publishOverlay() {
  if (!validateOverlayForPublishing()) {
    return;
  }

  isPublishing.value = true;

  try {
    // AI : Step 1 - Ensure project exists on server first
    await ensureProjectOnServer();

    // AI : Step 2 - Prepare and upload image if needed
    const filename = await prepareImageForServer();

    // AI : Step 3 - Publish overlay metadata
    const publishResult = await publishOverlayToServer(filename);

    // AI : If publishing was successful, update overlay ID and delete from local IndexedDB
    if (publishResult.success && publishResult.id) {
      // AI : Store the old ID for IndexedDB deletion
      const oldId = currentOverlay.value.id;

      // AI : Update the overlay ID with the one from the backend
      currentOverlay.value.id = publishResult.id;
    }

    // AI : Refresh project overlays from backend to update marker colors
    if (project.value?.cityId) {
      try {
        await loadCityProjects(project.value.cityId, project.value.city?.name ?? 'Unknown City');
      } catch (error) {
        console.warn('AI : Failed to refresh project overlays after publishing:', error);
      }
    }
  } catch (error) {
    console.error('AI : Failed to publish overlay:', error);
    toast.add({
      severity: 'error',
      summary: 'Publish Failed',
      detail: 'Failed to save to server. Please try again.',
      life: 3000
    });
  } finally {
    isPublishing.value = false;
  }
}

// AI : Load projects when user actually clicks on the ProjectPicker select
async function onProjectPickerSelectFocus() {
  // No longer needed, projects are loaded on map view.
}
</script>

<style scoped>
.info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: white;
  cursor: text;
  user-select: text;
  border-radius: 8px;
  /* AI : So that the popup sits above the toolbar, no matter its height */
  translate: 0px calc(-100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  /* AI : Compact styles for InfoPopup */
  max-width: 300px;
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.info-popup .p-button-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.info-popup .space-y-1>*+* {
  margin-top: 0.25rem;
}
</style>
