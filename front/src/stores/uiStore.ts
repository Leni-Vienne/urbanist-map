import { defineStore } from "pinia";
import { ref } from "vue";
import type { Project, OverlayObject } from "@/types/index";

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

  const overlayEditForm = ref<EditFormState>({
    visible: false,
  });

  // AI : Mobile drawer state
  const mobileDrawerActiveTab = ref<"latest" | "uploads" | "moderation">(
    "latest",
  );
  const mobileDrawerVisible = ref(true); // AI : Open by default on mobile
  const mobileDrawerHeightPercent = ref(40); // AI : Drawer height as percentage of viewport (10-90%)

  // AI : Project info popup state (for standalone projects)
  const projectInfoPopup = ref({
    visible: false,
    projectId: null as string | null,
    project: null as Project | null,
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
  function openProjectDialog(
    project?: Partial<Project>,
    mode: "create" | "edit" = "create",
  ) {
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

  // AI : Overlay edit form actions
  function openOverlayEditForm(overlay: OverlayObject) {
    overlayEditForm.value = {
      visible: true,
      data: overlay,
    };
  }

  function closeOverlayEditForm() {
    overlayEditForm.value = {
      visible: false,
    };
  }

  // AI : Mobile drawer actions
  function setMobileDrawerActiveTab(tab: "latest" | "uploads" | "moderation") {
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
    overlayEditForm.value.visible = false;
    projectInfoPopup.value.visible = false;
    moderatedContributionsDialogVisible.value = false;
  }

  return {
    // AI : State
    authModalVisible,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    projectDialog,
    projectEditForm,
    overlayEditForm,
    mobileDrawerActiveTab,
    mobileDrawerVisible,
    mobileDrawerHeightPercent,
    projectInfoPopup,
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
    openOverlayEditForm,
    closeOverlayEditForm,
    setMobileDrawerActiveTab,
    setMobileDrawerHeight,
    openProjectInfoPopup,
    closeProjectInfoPopup,
    openModeratedContributionsDialog,
    closeModeratedContributionsDialog,
    setLastCreatedProject,
    setFileUploadFlow,
    closeAllDialogs,
  };
});
