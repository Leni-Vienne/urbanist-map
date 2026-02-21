import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Project, OverlayObject } from "@/types/index";
import type { PanelTab } from "@/types";
import { useProjectStore } from "@/stores/pinia/projectStore";

interface ProjectDialogState {
  visible: boolean;
  project?: Partial<Project>;
}

interface EditFormState {
  visible: boolean;
  data?: Project | OverlayObject;
}

interface ProjectInfoPopupState {
  visible: boolean;
  projectId: string | null;
  project: Project | null;
}

interface ImageUploadDialogState {
  visible: boolean;
  projectId: string | null;
}

export const useUiStore = defineStore("ui", () => {
  // AI : Dialog visibility states
  const authModalVisible = ref(false);
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);
  const welcomeDialogVisible = ref(false);

  // AI : Badge indicator — set by ModeratedContributionsWatcher so UserMenu never imports the composable
  const hasUnacknowledgedModeratedContributions = ref(false);

  // AI : Project dialog state
  const projectDialog = ref<ProjectDialogState>({
    visible: false,
  });

  // AI : Edit form states
  const projectEditForm = ref<EditFormState>({
    visible: false,
  });

  // AI : Shared overlay edit dialog state - can be opened from anywhere
  const overlayEditDialog = ref<{
    visible: boolean;
    overlay: OverlayObject | null;
  }>({
    visible: false,
    overlay: null,
  });

  // AI : Unified active tab state (shared between desktop SideMenu and mobile MobileDrawer)
  // AI : Single source of truth for panel tab navigation
  const activeTab = ref<PanelTab>("latest");
  const mobileDrawerVisible = ref(true); // AI : Open by default on mobile
  const mobileDrawerHeightPercent = ref(40); // AI : Drawer height as percentage of viewport (10-90%)

  // AI : Project info popup state (for standalone projects)
  const projectInfoPopup = ref<ProjectInfoPopupState>({
    visible: false,
    projectId: null,
    project: null,
  });

  // AI : Image upload dialog state
  const imageUploadDialog = ref<ImageUploadDialogState>({
    visible: false,
    projectId: null,
  });

  // AI : Post-login callback - stores action to execute after successful login
  const postLoginCallback = ref<(() => void) | null>(null);

  // AI : Project dialog actions
  function openProjectDialog(project?: Partial<Project>) {
    projectDialog.value = {
      visible: true,
      project,
    };
  }

  function closeProjectDialog() {
    projectDialog.value = {
      visible: false,
    };
  }

  // AI : Project edit form actions
  function openProjectEditForm(project: Project) {
    // AI : Cache original project state for reset functionality
    // AI : This is critical for projects loaded from nearbyProjects or allProjects
    // AI : which bypass the normal caching in updateProject
    const projectStore = useProjectStore();
    if (project.id && project.status !== null && !project.isModified) {
      projectStore.cacheProjectBackendState(project.id);
    }

    projectEditForm.value = {
      visible: true,
      data: project,
    };
  }

  function closeProjectEditForm() {
    projectEditForm.value = {
      visible: false,
    };
  }

  // AI : Shared overlay edit dialog actions - used by both sidemenu and info popup
  function openOverlayEditDialog(overlay: OverlayObject) {
    overlayEditDialog.value = {
      visible: true,
      overlay,
    };
  }

  function closeOverlayEditDialog() {
    overlayEditDialog.value = {
      visible: false,
      overlay: null,
    };
  }

  // AI : Project info popup actions
  function openProjectInfoPopup(projectId: string, project?: Project) {
    projectInfoPopup.value = {
      visible: true,
      projectId,
      project: project || null,
    };
  }

  function closeProjectInfoPopup() {
    projectInfoPopup.value = {
      visible: false,
      projectId: null,
      project: null,
    };
  }

  // AI : Image upload dialog actions
  function openImageUploadDialog(projectId: string) {
    imageUploadDialog.value = {
      visible: true,
      projectId,
    };
  }

  function closeImageUploadDialog() {
    imageUploadDialog.value = {
      visible: false,
      projectId: null,
    };
  }

  // AI : Post-login callback actions
  function setPostLoginCallback(callback: (() => void) | null) {
    postLoginCallback.value = callback;
  }

  function executePostLoginCallback() {
    if (postLoginCallback.value) {
      postLoginCallback.value();
      postLoginCallback.value = null; // AI : Clear after execution
    }
  }

  // AI : Close all UI elements (used for cleanup)
  function closeAllDialogs() {
    authModalVisible.value = false;
    markerPlacementBarVisible.value = false;
    projectDialog.value.visible = false;
    projectEditForm.value.visible = false;
    overlayEditDialog.value.visible = false;
    projectInfoPopup.value.visible = false;
    moderatedContributionsDialogVisible.value = false;
    imageUploadDialog.value.visible = false;
    welcomeDialogVisible.value = false;
  }

  return {
    // AI : State
    authModalVisible,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    welcomeDialogVisible,
    hasUnacknowledgedModeratedContributions,
    projectDialog,
    projectEditForm,
    overlayEditDialog,
    activeTab,
    mobileDrawerVisible,
    mobileDrawerHeightPercent,
    projectInfoPopup,
    imageUploadDialog,
    postLoginCallback,

    // AI : Actions
    openProjectDialog,
    closeProjectDialog,
    openProjectEditForm,
    closeProjectEditForm,
    openOverlayEditDialog,
    closeOverlayEditDialog,
    openProjectInfoPopup,
    closeProjectInfoPopup,
    openImageUploadDialog,
    closeImageUploadDialog,
    setPostLoginCallback,
    executePostLoginCallback,
    closeAllDialogs,
  };
});

// AI : Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
