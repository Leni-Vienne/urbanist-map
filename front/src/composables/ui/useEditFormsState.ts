import { ref } from 'vue'
import type { Project, OverlayObject } from '../../types'

// AI : Global state for edit forms to prevent modal issues and key interference
const showProjectEditForm = ref(false)
const showOverlayEditForm = ref(false)
const projectEditData = ref<Project | null>(null)
const overlayEditData = ref<OverlayObject | null>(null)

export function useEditFormsState() {
  function openProjectEditForm(project: Project) {
    projectEditData.value = project
    showProjectEditForm.value = true
  }

  function closeProjectEditForm() {
    showProjectEditForm.value = false
    projectEditData.value = null
  }

  function openOverlayEditForm(overlay: OverlayObject) {
    overlayEditData.value = overlay
    showOverlayEditForm.value = true
  }

  function closeOverlayEditForm() {
    showOverlayEditForm.value = false
    overlayEditData.value = null
  }

  return {
    showProjectEditForm,
    showOverlayEditForm,
    projectEditData,
    overlayEditData,
    openProjectEditForm,
    closeProjectEditForm,
    openOverlayEditForm,
    closeOverlayEditForm
  }
}