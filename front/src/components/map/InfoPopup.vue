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
    >      <!-- Project Selection Section - Only visible in edit mode -->
      <div 
        v-if="!props.viewMode"
        class="project-selection mb-3"
      >
        <div class="text-sm font-semibold mb-2 text-gray-700">Project Assignment</div>
        <ProjectPicker
          v-model="selectedProjectId"
          @project-selected="applyProjectChange"
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
        </div>        <div class="p-2 rounded bg-gray-50 text-sm space-y-1">
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Name:</span>
            <span class="text-right">{{ project.name || 'Not specified' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Location:</span>
            <span class="text-right">{{ project.location || 'Not specified' }}</span>
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
          <div v-if="project.sourceUrl" class="flex justify-between">
            <span class="font-medium text-gray-600">Source:</span>
            <a :href="project.sourceUrl" target="_blank" class="text-blue-600 hover:underline text-xs truncate max-w-32">{{ project.sourceUrl }}</a>
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
            <span class="font-medium text-gray-600">ID:</span>
            <span class="font-mono text-xs">{{ props.overlayObject.id }}</span>
          </div>
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Name:</span>
            <span class="text-right">{{ props.overlayObject.phase || 'Not specified' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="font-medium text-gray-600">Sequence:</span>
            <span class="text-right">{{ props.overlayObject.sequenceNumber || 'Not specified' }}</span>
          </div>
        </div>
        <OverlayEditor 
          ref="overlayEditorRef"
          :overlayObject="props.overlayObject" 
          @update="onOverlayUpdate"
        />
      </div>
    </div>    <!-- Publish Overlay Section -->
    <div v-if="!props.viewMode && project" class="publish-section">
      <div class="text-sm font-semibold mb-2 text-gray-700">Publish to Server</div>
      <div class="p-2 rounded bg-blue-50">
        <p class="text-xs text-gray-600 mb-2">
          Save this overlay to the server database for permanent storage.
        </p>
        <Button
          label="Publish Overlay"
          icon="pi pi-cloud-upload"
          class="p-button-success p-button-sm w-full"
          :loading="isPublishing"
          @click="publishOverlay"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useToast } from '@composables/ui/useToast';
import { updateTooltipText } from '@composables/overlay/useOverlayActions';
import { projects, addOverlayToProjectWithId, removeOverlayFromProjectWithId } from '@composables/project/useProjects';
import { navigateToProjectEdit } from '@composables/ui/useRouterNavigation';
import { deleteOverlay, deleteProject } from '@composables/core/useDatabase';
import ProjectPicker from '@components/project/ProjectPicker.vue';
import OverlayEditor from '@components/map/OverlayEditor.vue';
import type { OverlayObject } from '@types';
import { trpc } from '@client'

const props = defineProps<{
  overlayObject: OverlayObject;
  onProjectSubmit?: (data: any) => void;
  viewMode?: boolean;
}>();

const toast = useToast();
const loading = ref(true);
const editingProject = ref(false);
const selectedProjectId = ref<string | undefined>(props.overlayObject.projectId);
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);
const isPublishing = ref(false);

// AI : Use a reactive reference for the current project ID to ensure reactivity
const currentProjectId = ref<string | undefined>(props.overlayObject.projectId);

// AI : Make project reactive to changes in projects store and currentProjectId
const project = computed(() => {
  if (currentProjectId.value) {
    // AI : First try to get from local projects store (for edit mode and local overlays)
    const localProject = projects.value[currentProjectId.value];
    if (localProject) {
      return localProject;    }
      // AI : If not found locally, check if this overlay has backend project data (for view mode)
    if (props.overlayObject.project && props.overlayObject.project.id === currentProjectId.value) {
      // AI : Convert backend project data to frontend format
      const project = props.overlayObject.project;
      const metadata = project.metadata as {
        location?: string;
        startDate?: string;
        endDate?: string;
        sourceUrl?: string;
        overlayIds?: string[];
        color?: string;
        createdAt?: string;
        updatedAt?: string;
      } | null;

      return {
        id: project.id,
        name: project.title,
        description: project.description || '',
        color: metadata?.color || '#007bff',
        location: metadata?.location || '',
        startDate: metadata?.startDate ? new Date(metadata.startDate) : null,
        endDate: metadata?.endDate ? new Date(metadata.endDate) : null,
        sourceUrl: metadata?.sourceUrl || '',
        overlayIds: [],
        createdAt: project.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: project.updatedAt?.toISOString() || new Date().toISOString()
      };
    }
  }
  return null;
});

// AI : Watch for changes in overlay's projectId to update both selectedProjectId and currentProjectId
watch(() => props.overlayObject.projectId, (newProjectId) => {
  selectedProjectId.value = newProjectId;
  currentProjectId.value = newProjectId;
}, { immediate: true });

// AI : Format date for display
function formatDate(date: Date | null): string {
  if (!date) return 'Not specified';
  return new Date(date).toLocaleDateString();
}

// AI : Format currency for display
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

// AI : Handle overlay update from the OverlayEditor component
function onOverlayUpdate(overlayId: string, phase?: string, sequenceNumber?: number) {
  // AI : Update the local data if needed
  if (overlayId === props.overlayObject.id) {
    props.overlayObject.phase = phase;
    props.overlayObject.sequenceNumber = sequenceNumber;
  }
}

// AI : Apply project change to overlay
async function applyProjectChange(projectId: string) {
  try {
    const originalProjectId = props.overlayObject.projectId;

    // AI : If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await removeOverlayFromProjectWithId(originalProjectId, props.overlayObject.id);
    }

    // AI : Add to the new project
    await addOverlayToProjectWithId(projectId, props.overlayObject.id);

    // AI : Update local state - both the prop and reactive references
    props.overlayObject.projectId = projectId;
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

    // AI : Close editing mode
    editingProject.value = false;

    // AI : Update the tooltip text
    updateTooltipText();  } catch (error) {
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
  
  // AI : Check corners from overlay object or get them directly from the overlay
  let corners = props.overlayObject.corners;
  if (!corners || corners.length !== 4) {
    // AI : Try to get corners directly from the overlay if they're not stored
    if (props.overlayObject.overlay) {
      corners = props.overlayObject.overlay.getCorners();
      // AI : Update the overlay object with the current corners
      if (corners && corners.length === 4) {
        props.overlayObject.corners = corners;
      }
    }
  }
  
  if (!corners || corners.length !== 4) {
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
      title: project.value.name,
      description: project.value.description,
      metadata: {
        location: project.value.location,
        startDate: project.value.startDate?.toISOString(),
        endDate: project.value.endDate?.toISOString(),
        sourceUrl: project.value.sourceUrl,
        overlayIds: project.value.overlayIds,
        color: project.value.color,
        createdAt: project.value.createdAt,
        updatedAt: project.value.updatedAt
      }
    });    if (!projectResult.success) {
      throw new Error('Failed to publish project to server');
    }
    
    // AI : Handle project ID update and IndexedDB cleanup if this is a new project
    if (projectResult.success && projectResult.id) {
      const oldProjectId = project.value.id;
      
      // AI : If this is a new project (not existing), update the project ID
      if (!projectResult.exists && projectResult.id !== oldProjectId) {
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
        props.overlayObject.projectId = projectResult.id;
        
        // AI : Delete the old project from IndexedDB using the old ID
        await deleteProject(oldProjectId);
      }
    }    // AI : Mark project as saved remotely (only for local projects, not backend ones)
    const localProject = projects.value[project.value.id];
    if (localProject) {
      localProject.savedRemotely = true;
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
  if (props.overlayObject.imageUrl.startsWith('data:')) {
    // AI : Convert data URL to WebP if needed and upload
    const imageFile = await convertToWebPIfNeeded(props.overlayObject.imageUrl, `overlay-${props.overlayObject.id}.webp`);
    
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
    const urlParts = props.overlayObject.imageUrl.split('/');
    return urlParts[urlParts.length - 1];
  }
}

// AI : Publish overlay metadata to server
async function publishOverlayToServer(filename: string): Promise<{ success: boolean; exists: boolean; id?: string }> {
  const payload = {
    id: props.overlayObject.id,
    filename: filename,
    caption: props.overlayObject.phase || undefined,
    projectId: props.overlayObject.projectId!,
    metadata: {
      phase: props.overlayObject.phase,
      sequenceNumber: props.overlayObject.sequenceNumber,
      history: props.overlayObject.history
      // AI : Exclude imageResolutions as they contain image data that shouldn't be stored in database
    },
    corners: props.overlayObject.corners
  };
  
  const overlayResult = await trpc.overlay.publishOverlay.mutate(payload);

  if (overlayResult.success) {
    // AI : Update local overlay state to track server existence
    props.overlayObject.savedRemotely = true;
    
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
      const oldId = props.overlayObject.id;
      
      // AI : Update the overlay ID with the one from the backend
      props.overlayObject.id = publishResult.id;
      
      // AI : Delete the old overlay from IndexedDB using the old ID
      await deleteOverlay(oldId);
    }  } catch (error) {
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

// AI : Initialize component
onMounted(async () => {
  loading.value = false;
});
</script>

<style scoped>
@import "tailwindcss-primeui";
.info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: white;
  user-select: text;
  border-radius: 8px;
  /* so that the popup sits above the toolbar, no matter its height*/
  translate: 0px calc(-100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

/* AI : Compact styles for InfoPopup */
.info-popup {
  max-width: 300px;
}

.info-popup .p-button-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.info-popup .space-y-1 > * + * {
  margin-top: 0.25rem;
}

</style>