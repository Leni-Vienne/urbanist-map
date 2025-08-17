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
        class="project-selection"
      >
        <div class="section-header">Project Assignment</div>
        <ProjectPicker
          v-model="projectPickerValue"
          @project-selected="applyProjectChange"
          :hideSelector="false"
          :useCityProjects="true"
          :placeholder="project ? 'Change project' : 'Select a project'"
        />
      </div>

      <!-- Project Information Section -->
      <div
        v-if="project"
        class="project-meta mb-3"
      >
        <div class="section-header-row">
          <div class="section-header">Project Information</div>
          <div class="project-actions">
            <!-- AI : Direct edit button (for owned projects or moderator pending projects) -->
            <Button
              v-if="!props.viewMode && project && user && project.ownerId === user.id"
              icon="pi pi-pencil"
              class="p-button-sm p-button-text p-button-info"
              @click="openProjectManagerForEdit"
              v-tooltip.top="'Edit Project'"
            />
            <!-- AI : Suggest changes button (for non-owned projects) -->
            <Button
              v-else-if="!props.viewMode && project && user && project.ownerId !== user.id"
              icon="pi pi-file-edit"
              class="p-button-sm p-button-text p-button-secondary"
              @click="openProjectEditFormLocal"
              v-tooltip.top="'Suggest Changes'"
            />
          </div>
        </div>
        <div class="info-card">
          <div class="info-row">
            <span class="info-label">Name:</span>
            <span class="info-value">{{ project.name ?? 'Not specified' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Location:</span>
            <span class="info-value">{{ getProjectLocationDisplay(project) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Period:</span>
            <span class="info-value info-small">
              <span v-if="!project.startDate && !project.endDate">Not specified</span>
              <span v-else>
                {{ formatDate(project.startDate) }} - {{ project.endDate ? formatDate(project.endDate) : 'Present' }}
              </span>
            </span>
          </div>
          <div
            v-if="project.sourceUrl"
            class="info-row"
          >
            <span class="info-label">Source:</span>
            <a
              :href="project.sourceUrl"
              target="_blank"
              class="info-link"
            >{{ project.sourceUrl }}</a>
          </div>
          <div
            v-if="project.latestUpdateOn"
            class="info-row"
          >
            <span class="info-label">Latest Update:</span>
            <span class="info-value info-small">{{ formatDate(project.latestUpdateOn) }}</span>
          </div>
        </div>
      </div>

      <!-- Overlay Information Section -->
      <div class="overlay-meta mb-3">
        <div class="section-header-row">
          <div class="section-header">Overlay Information</div>
          <div class="overlay-actions">
            <!-- AI : Direct edit button (for owned overlays) -->
            <Button
              v-if="!props.viewMode && currentOverlay && user && currentOverlay.authorId === user.id"
              icon="pi pi-pencil"
              class="p-button-sm p-button-text p-button-info"
              @click="openOverlayEditor"
              v-tooltip.top="'Edit Overlay'"
            />
            <!-- AI : Suggest changes button (for non-owned overlays) -->
            <Button
              v-else-if="!props.viewMode && currentOverlay && user && currentOverlay.authorId !== user.id"
              icon="pi pi-file-edit"
              class="p-button-sm p-button-text p-button-secondary"
              @click="openOverlayEditFormLocal"
              v-tooltip.top="'Suggest Changes'"
            />
          </div>
        </div>
        <div class="info-card">
          <div class="info-row">
            <span class="info-label">Name:</span>
            <span class="info-value">{{ currentOverlay.caption ?? 'Not specified' }}</span>
          </div>
          <div
            v-if="currentOverlay.replacesOverlayId"
            class="info-row"
          >
            <span class="info-label">Type:</span>
            <span class="info-value replacement-type">Replacement Overlay</span>
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
        severity="success"
        size="small"
        class="w-full"
        :loading="isPublishing"
        @click="publishOverlay"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, defineAsyncComponent } from 'vue';

import { useToast } from '@composables/ui/useToast';
import { updateTooltipText } from '@composables/overlay/useOverlayActions';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { storeToRefs } from 'pinia';
import { allMarkers, updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { useProjectDialogState } from '@composables/ui/useProjectDialogState';
import { useEditFormsState } from '@composables/ui/useEditFormsState';
import { loadCityProjects, citiesWithProjects, latestClickedCity } from '@composables/map/useCityMarkers';
import { getNearbyProjects } from '@composables/project/useNearbyProjects';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { useAuthStore } from '@stores/authStore';
import type { OverlayObject, Project } from '@types';
import { trpc } from '@client'

const ProjectPicker = defineAsyncComponent(() => import('@components/project/ProjectPicker.vue'));
const OverlayEditor = defineAsyncComponent(() => import('@components/map/OverlayEditor.vue'));

// AI : Get Pinia stores
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const { overlays, idSelectedOverlay } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { openProjectDialog } = useProjectDialogState();
const { openProjectEditForm, openOverlayEditForm } = useEditFormsState();

// AI : Use centralized selected project state
const { selectedProjectId } = useSelectedProject();

// AI : Use auth store for ownership checks
const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

const props = defineProps<{
  overlayObject: OverlayObject;
  onProjectSubmit?: (data: any) => void;
  viewMode?: boolean;
}>();

const toast = useToast();
const loading = ref(true);
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
        name: backendProject.name, // AI : Use name from updated backend schema
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

  // AI : If still no city found, use the selected city if it matches the project's cityId
  if (project.cityId && latestClickedCity.value && latestClickedCity.value.id === project.cityId) {
    return latestClickedCity.value.countryCode
      ? `${latestClickedCity.value.name}, ${latestClickedCity.value.countryCode}`
      : latestClickedCity.value.name;
  }

  return 'Not specified';
}

// AI : Apply project change to overlay
async function applyProjectChange(projectId: string) {
  try {
    const originalProjectId = currentOverlay.value.projectId;

    // AI : If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await projectStore.removeOverlayFromProjectWithId(originalProjectId, currentOverlay.value.id);
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

        // AI : Also set project data on overlay object for InfoPopup display - convert to compatible format
        currentOverlay.value.project = {
          id: nearbyProject.id,
          status: 'approved' as const,
          name: nearbyProject.name,
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
    await projectStore.addOverlayToProjectWithId(projectId, currentOverlay.value.id);

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

// AI : Open project dialog for edit
function openProjectManagerForEdit() {
  if (!project.value) return;

  // AI : Open dialog with project data for editing
  openProjectDialog(project.value, 'edit');
}

// AI : Open the overlay editor dialog
function openOverlayEditor() {
  overlayEditorRef.value?.openDialog();
}

// AI : Open project edit form using global state
function openProjectEditFormLocal() {
  if (project.value) {
    openProjectEditForm(project.value);
  }
}

// AI : Open overlay edit form using global state
function openOverlayEditFormLocal() {
  openOverlayEditForm(currentOverlay.value);
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
      name: project.value.name,
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
      detail: `Failed to publish project "${project.value.name}" to server: ${error instanceof Error ? error.message : String(error)}`,
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

    // AI : Get API URL based on environment (same logic as tRPC client)
    const getApiUrl = () => {
      if (import.meta.env.PROD) {
        return ''; // AI : Same origin in production
      }
      return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
    };

    const uploadResponse = await fetch(`${getApiUrl()}/api/upload-image`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image to server');
    }
    const uploadResult = await uploadResponse.json() as { filename: string };

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
    replacesOverlayId: currentOverlay.value.replacesOverlayId ?? undefined,
    metadata: {
      // AI : Keep metadata empty as requested - no caption or history data
    },
    corners: corners.map(c => ({ lat: c.lat, lng: c.lng })),
  };

  const overlayResult = await trpc.overlay.publishOverlay.mutate(payload);

  if (overlayResult.success) {
    const actionText = overlayResult.exists ? 'updated on' : 'saved to';
    const summaryText = currentOverlay.value.replacesOverlayId ? 'Replacement Submitted' : 'Overlay Published';
    const detailText = currentOverlay.value.replacesOverlayId
      ? `Replacement overlay has been submitted for moderation review`
      : `Overlay has been ${actionText} the server database`;

    toast.add({
      severity: 'success',
      summary: summaryText,
      detail: detailText,
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

    // AI : If publishing was successful, update overlay ID and update store
    if (publishResult.success && publishResult.id) {
      const oldId = currentOverlay.value.id;
      const newId = publishResult.id;

      // AI : Update overlay ID and reset modified flag since it's now saved
      currentOverlay.value.id = newId;
      currentOverlay.value.isModified = false;

      // AI : If ID changed, update the overlays store with new key
      if (oldId !== newId) {
        const updatedOverlays = { ...overlays.value };
        delete updatedOverlays[oldId]; // Remove old entry
        updatedOverlays[newId] = currentOverlay.value; // Add with new ID
        overlays.value = updatedOverlays;

        // AI : Also update marker in allMarkers if it exists
        if (allMarkers.value[oldId]) {
          const marker = allMarkers.value[oldId];
          delete allMarkers.value[oldId];
          allMarkers.value[newId] = marker;
        }

        // AI : Update project's overlayIds array to use new ID
        if (project.value?.id) {
          const updatedProjects = { ...projects.value };
          const projectToUpdate = { ...updatedProjects[project.value.id] };
          
          // Replace old overlay ID with new ID in the project's overlayIds array
          const overlayIndex = projectToUpdate.overlayIds.indexOf(oldId);
          if (overlayIndex !== -1) {
            projectToUpdate.overlayIds = [...projectToUpdate.overlayIds];
            projectToUpdate.overlayIds[overlayIndex] = newId;
            updatedProjects[project.value.id] = projectToUpdate;
            projects.value = updatedProjects;
          }
        }

        // AI : Update selected overlay ID if this was the selected one
        if (idSelectedOverlay.value === oldId) {
          idSelectedOverlay.value = newId;
        }
      }

      // AI : Update marker tooltip to reflect new published state (green color)
      updateMarkerTooltip(currentOverlay.value);
    }

    // AI : Refresh project overlays from backend to update marker colors
    // AI : Skip refresh for locally created projects to avoid overwriting the just-published overlay
    if (project.value?.cityId && project.value.savedRemotely) {
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

</script>

<style scoped>
.info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: var(--p-surface-0);
  cursor: text;
  user-select: text;
  border-radius: 0.75rem;
  /* AI : So that the popup sits above the toolbar, no matter its height */
  translate: 0px calc(-100% - 32px);
  box-shadow: var(--p-shadow-md);
  /* AI : Compact styles for InfoPopup */
  max-width: 300px;
  border: 1px solid var(--p-surface-border);
  /* AI : Prevent dev tools interference */
  pointer-events: auto;
  position: relative;
  z-index: 1000;
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


.project-actions,
.overlay-actions {
  display: flex;
  gap: 0.25rem;
}

/* AI : Section styling */
.project-selection {
  margin-bottom: 1rem;
}

.section-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-surface-700);
  margin-bottom: 0.5rem;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

/* AI : Info card styling */
.info-card {
  background-color: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 0.375rem;
  padding: 0.75rem;
  font-size: 0.875rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  font-weight: 500;
  color: var(--p-surface-600);
  flex-shrink: 0;
  margin-right: 0.5rem;
}

.info-value {
  text-align: right;
  color: var(--p-surface-900);
  flex-grow: 1;
  word-wrap: break-word;
}

.info-small {
  font-size: 0.75rem;
}

.info-link {
  color: var(--p-primary-500);
  text-decoration: none;
  font-size: 0.75rem;
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-link:hover {
  text-decoration: underline;
}

.replacement-type {
  font-weight: 600;
  color: var(--p-purple-500);
}

</style>
