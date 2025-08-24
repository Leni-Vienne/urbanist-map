<template>
  <!-- AI : Project Selector Dialog -->
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

  <!-- AI : Project Dialog for create/edit -->
  <ProjectDialog
    v-if="uiStore.projectDialog.visible"
    v-model:visible="uiStore.projectDialog.visible"
    :project="uiStore.projectDialog.project ?? {}"
    :mode="uiStore.projectDialog.mode"
    :title="uiStore.projectDialog.mode === 'create' ? 'Create New Project' : 'Edit Project'"
    @submit="handleProjectSubmitted"
    @cancel="uiStore.closeProjectDialog"
  />

  <!-- AI : Project Edit Form Dialog -->
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

  <!-- AI : Overlay Edit Form Dialog -->
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

  <!-- AI : Image Upload Dialog -->
  <ImageUploadDialog
    v-model:visible="uiStore.imageUploadDialogVisible"
    @file-selected="onImageUploadFromDialog"
  />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import ImageUploadDialog from '@components/dialogs/ImageUploadDialog.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects'
import { addOverlay } from '@composables/overlay/useOverlay'
import { setLastCreatedProject } from '@composables/ui/useProjectState'
import { createProject } from '@composables/project/useProjects'
import type { Project, OverlayObject } from '@types'

const ProjectPicker = defineAsyncComponent(() => import('@components/project/ProjectPicker.vue'))
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'))
const EditableProjectForm = defineAsyncComponent(() => import('@components/forms/EditableProjectForm.vue'))
const EditableOverlayForm = defineAsyncComponent(() => import('@components/forms/EditableOverlayForm.vue'))

const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const uiStore = useUiStore()
const toast = useToast()
const projectPickerRef = ref()

const { projects } = storeToRefs(projectStore)
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore)

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : Check if project exists in local store, if not, try to get it from nearby projects
  if (!projects.value[projectId]) {
    try {
      // AI : Fetch nearby projects to get the selected project data
      const nearbyProjects = await fetchNearbyProjects()
      const nearbyProject = nearbyProjects.find((p: any) => p.id === projectId)

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
        }

        // AI : Add project to local store
        projects.value[projectId] = localProject
      } else {
        console.warn('AI : Project not found in nearby projects, overlay creation may not work properly')
      }
    } catch (error) {
      console.error('AI : Error fetching nearby projects for project selection:', error)
    }
  }

  await handleFileUpload(projectId, !!replacementOverlayId.value)
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement: boolean = false) {
  if (!pendingImageFile.value) {
    console.warn('No image file to upload')
    toast.add({
      severity: 'warn',
      summary: 'No file selected',
      detail: 'Please select an image file to upload',
      life: 3000
    })
    uiStore.closeProjectSelector()
    return
  }

  const reader = new FileReader()
  reader.onload = async () => {
    try {
      if (isReplacement && replacementOverlayId.value) {
        // AI : Create replacement overlay using the standard overlay creation process
        const overlayId = await addOverlay(reader.result as string, projectId, replacementOverlayId.value)

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: 'Replacement Overlay Created',
            detail: 'Your replacement overlay has been created and is ready for editing',
            life: 3000
          })
        }
      } else {
        // AI : Regular overlay addition
        await addOverlay(reader.result as string, projectId)
        // AI : Don't show toast here - addOverlayToProjectWithId will show a more specific toast
      }
    } catch (error) {
      console.error('Error handling file upload:', error)
      toast.add({
        severity: 'error',
        summary: 'Upload Failed',
        detail: 'Failed to process the image overlay',
        life: 3000
      })
    } finally {
      // AI : Reset state
      overlayStore.resetReplacement()
      uiStore.closeProjectSelector()
    }
  }
  reader.readAsDataURL(pendingImageFile.value)
}

// AI : Handle file selection from dialog
async function onImageUploadFromDialog(file: File) {
  overlayStore.handleFileSelected(file)
  // AI : Show project selector for overlay workflow
  uiStore.openProjectSelector()
}

// AI : Fetch projects for picker when dropdown is focused
async function fetchProjectsForPicker() {
  try {
    // AI : Fetch nearby projects based on current map view
    await fetchNearbyProjects()
  } catch (error) {
    console.error('Error fetching projects for picker:', error)
  }
}

// AI : Handle project creation/update from dialog
async function handleProjectSubmitted(project: any) {
  uiStore.closeProjectDialog()
  
  // AI : Create the project in the store if it doesn't already have an ID
  if (project && !project.id) {
    try {
      // AI : Create the project and get the generated ID
      const projectId = await createProject(project)
      setLastCreatedProject(projectId)
      
      // AI : Re-open the project selector so the ProjectPicker can auto-select the new project
      // AI : and continue with the file upload workflow
      if (pendingImageFile.value) {
        uiStore.openProjectSelector()
      }
    } catch (error) {
      console.error('Error creating project:', error)
      toast.add({
        severity: 'error',
        summary: 'Project Creation Failed',
        detail: 'Failed to create the project. Please try again.',
        life: 3000
      })
    }
  } else if (project && project.id) {
    // AI : Project already exists (edit mode), just set it as last created for consistency
    setLastCreatedProject(project.id)
    
    if (pendingImageFile.value) {
      uiStore.openProjectSelector()
    }
  }
}
</script>

<style scoped>
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