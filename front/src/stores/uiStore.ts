import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Project, OverlayObject } from '@types';

export interface ProjectDialogState {
  visible: boolean;
  project?: Partial<Project>;
  mode: 'create' | 'edit';
}

export interface EditFormState {
  visible: boolean;
  data?: Project | OverlayObject;
}

export const useUiStore = defineStore('ui', () => {
  // AI : Dialog visibility states
  const authModalVisible = ref(false);
  const imageUploadDialogVisible = ref(false);
  const projectSelectorVisible = ref(false);

  // AI : Project dialog state
  const projectDialog = ref<ProjectDialogState>({
    visible: false,
    mode: 'create'
  });

  // AI : Edit form states
  const projectEditForm = ref<EditFormState>({
    visible: false
  });

  const overlayEditForm = ref<EditFormState>({
    visible: false
  });

  // AI : Mobile drawer state
  const mobileDrawerActiveTab = ref<'latest' | 'uploads' | 'admin'>('latest');
  const mobileDrawerVisible = ref(true); // AI : Open by default on mobile
  
  // AI : Project info popup state (for development projects)
  const projectInfoPopup = ref({
    visible: false,
    projectId: null as string | null,
    project: null as Project | null
  });

  // AI : Auth modal actions
  function openAuthModal() {
    authModalVisible.value = true;
  }

  function closeAuthModal() {
    authModalVisible.value = false;
  }

  // AI : Image upload dialog actions
  function openImageUploadDialog() {
    imageUploadDialogVisible.value = true;
  }

  function closeImageUploadDialog() {
    imageUploadDialogVisible.value = false;
  }

  // AI : Project selector actions
  function openProjectSelector() {
    projectSelectorVisible.value = true;
  }

  function closeProjectSelector() {
    projectSelectorVisible.value = false;
  }

  // AI : Project dialog actions
  function openProjectDialog(project?: Partial<Project>, mode: 'create' | 'edit' = 'create') {
    projectDialog.value = {
      visible: true,
      project,
      mode
    };
  }

  function closeProjectDialog() {
    projectDialog.value = {
      visible: false,
      mode: 'create'
    };
  }

  // AI : Project edit form actions
  function openProjectEditForm(project: Project) {
    projectEditForm.value = {
      visible: true,
      data: project
    };
  }

  function closeProjectEditForm() {
    projectEditForm.value = {
      visible: false
    };
  }

  // AI : Overlay edit form actions
  function openOverlayEditForm(overlay: OverlayObject) {
    overlayEditForm.value = {
      visible: true,
      data: overlay
    };
  }

  function closeOverlayEditForm() {
    overlayEditForm.value = {
      visible: false
    };
  }

  // AI : Mobile drawer actions
  function setMobileDrawerActiveTab(tab: 'latest' | 'uploads' | 'admin') {
    mobileDrawerActiveTab.value = tab;
  }
  
  // AI : Project info popup actions
  function openProjectInfoPopup(projectId: string, project?: Project) {
    projectInfoPopup.value = {
      visible: true,
      projectId,
      project: project || null
    };
  }
  
  function closeProjectInfoPopup() {
    projectInfoPopup.value = {
      visible: false,
      projectId: null,
      project: null
    };
    
    // AI : Don't clean up teleport target immediately - let it stay for next click
    // The cleanup will happen when switching markers or cities
  }

  // AI : Close all UI elements (used for cleanup)
  function closeAllDialogs() {
    authModalVisible.value = false;
    imageUploadDialogVisible.value = false;
    projectSelectorVisible.value = false;
    projectDialog.value.visible = false;
    projectEditForm.value.visible = false;
    overlayEditForm.value.visible = false;
    projectInfoPopup.value.visible = false;
  }

  return {
    // AI : State
    authModalVisible,
    imageUploadDialogVisible,
    projectSelectorVisible,
    projectDialog,
    projectEditForm,
    overlayEditForm,
    mobileDrawerActiveTab,
    mobileDrawerVisible,
    projectInfoPopup,

    // AI : Actions
    openAuthModal,
    closeAuthModal,
    openImageUploadDialog,
    closeImageUploadDialog,
    openProjectSelector,
    closeProjectSelector,
    openProjectDialog,
    closeProjectDialog,
    openProjectEditForm,
    closeProjectEditForm,
    openOverlayEditForm,
    closeOverlayEditForm,
    setMobileDrawerActiveTab,
    openProjectInfoPopup,
    closeProjectInfoPopup,
    closeAllDialogs
  };
});
