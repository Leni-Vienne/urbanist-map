import { defineStore } from "pinia";
import { ref } from "vue";
import type { Project, OverlayObject } from "@/types/index";
import type { PanelTab } from "@/types";
import { useProjectStore } from "@/stores/pinia/projectStore";

export interface ProjectDialogState {
  visible: boolean;
  project?: Partial<Project>;
  mode: "create" | "edit";
}

export interface EditFormState {
  visible: boolean;
  data?: Project | OverlayObject;
}

export const useUiStore = defineStore("ui", () => {
  // AI : Dialog visibility states
  const authModalVisible = ref(false);
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);

  // AI : Project dialog state
  const projectDialog = ref<ProjectDialogState>({
    visible: false,
    mode: "create",
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

  // AI : Mobile drawer state
  const mobileDrawerActiveTab = ref<PanelTab>("latest");
  const mobileDrawerVisible = ref(true); // AI : Open by default on mobile
  const mobileDrawerHeightPercent = ref(40); // AI : Drawer height as percentage of viewport (10-90%)

  // AI : Project info popup state (for standalone projects)
  const projectInfoPopup = ref({
    visible: false,
    projectId: null as string | null,
    project: null as Project | null,
  });

  // AI : Image upload dialog state
  const imageUploadDialog = ref({
    visible: false,
    projectId: null as string | null,
  });

  // AI : Project creation flow state (moved from useProjectState)
  const lastCreatedProjectId = ref<string | null>(null);
  const inFileUploadFlow = ref<boolean>(false);

  // AI : Auth modal actions
  function openAuthModal() {
    authModalVisible.value = true;
  }

  function closeAuthModal() {
    authModalVisible.value = false;
  }

  // AI : Marker placement bar actions
  function openMarkerPlacementBar() {
    markerPlacementBarVisible.value = true;
  }

  function closeMarkerPlacementBar() {
    markerPlacementBarVisible.value = false;
  }

  // AI : Project dialog actions
  function openProjectDialog(project?: Partial<Project>, mode: "create" | "edit" = "create") {
    projectDialog.value = {
      visible: true,
      project,
      mode,
    };
  }

  function closeProjectDialog() {
    projectDialog.value = {
      visible: false,
      mode: "create",
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

  // AI : Mobile drawer actions
  function setMobileDrawerActiveTab(tab: PanelTab) {
    mobileDrawerActiveTab.value = tab;
  }

  function setMobileDrawerHeight(heightPercent: number) {
    mobileDrawerHeightPercent.value = Math.min(90, heightPercent);
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

  // AI : Moderated contributions dialog actions
  function openModeratedContributionsDialog() {
    moderatedContributionsDialogVisible.value = true;
  }

  function closeModeratedContributionsDialog() {
    moderatedContributionsDialogVisible.value = false;
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

  // AI : Project creation flow actions (moved from useProjectState)
  function setLastCreatedProject(projectId: string | null) {
    lastCreatedProjectId.value = projectId;
  }

  function setFileUploadFlow(active: boolean) {
    inFileUploadFlow.value = active;
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
  }

  return {
    // AI : State
    authModalVisible,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    projectDialog,
    projectEditForm,
    overlayEditDialog,
    mobileDrawerActiveTab,
    mobileDrawerVisible,
    mobileDrawerHeightPercent,
    projectInfoPopup,
    imageUploadDialog,
    lastCreatedProjectId,
    inFileUploadFlow,

    // AI : Actions
    openAuthModal,
    closeAuthModal,
    openMarkerPlacementBar,
    closeMarkerPlacementBar,
    openProjectDialog,
    closeProjectDialog,
    openProjectEditForm,
    closeProjectEditForm,
    openOverlayEditDialog,
    closeOverlayEditDialog,
    setMobileDrawerActiveTab,
    setMobileDrawerHeight,
    openProjectInfoPopup,
    closeProjectInfoPopup,
    openModeratedContributionsDialog,
    closeModeratedContributionsDialog,
    openImageUploadDialog,
    closeImageUploadDialog,
    setLastCreatedProject,
    setFileUploadFlow,
    closeAllDialogs,
  };
});
