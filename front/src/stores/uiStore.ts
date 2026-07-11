import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Project, OverlayObject, PanelTab } from "@/types/index";

// Minimal overlay data needed to open the edit dialog (caption editor only)
export type OverlayEditTarget = Pick<OverlayObject, "id" | "caption">;

interface ProjectDialogState {
  visible: boolean;
  project?: Partial<Project>;
}

interface EditFormState {
  visible: boolean;
  data?: Project | OverlayObject;
}

interface ImageUploadDialogState {
  visible: boolean;
  projectId: string | null;
}

interface ShapeEditorState {
  project: Project | null;
  // Whether to reopen the project's docked detail once shape editing ends.
  reopen: boolean;
}

export const useUiStore = defineStore("ui", () => {
  const authModalVisible = ref(false);
  const authModalInitialMode = ref<"login" | "signup">("login");
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);

  // Badge indicator, set by ModeratedContributionsWatcher so UserMenu never imports the composable
  const hasUnacknowledgedModeratedContributions = ref(false);

  const projectDialog = ref<ProjectDialogState>({
    visible: false,
  });

  const projectEditForm = ref<EditFormState>({
    visible: false,
  });

  // Shared overlay edit dialog state - can be opened from anywhere
  // Uses OverlayEditTarget (not full OverlayObject) - dialog only needs id + caption
  const overlayEditDialog = ref<{
    visible: boolean;
    overlay: OverlayEditTarget | null;
  }>({
    visible: false,
    overlay: null,
  });

  // Shared tab state between desktop SideMenu and mobile MobileDrawer
  const activeTab = ref<PanelTab>("latest");
  const mobileDrawerHeightPercent = ref(40); // Drawer height as percentage of viewport (10-90%)

  const imageUploadDialog = ref<ImageUploadDialogState>({
    visible: false,
    projectId: null,
  });

  const shapeEditor = ref<ShapeEditorState>({ project: null, reopen: false });

  // Shared accordion state that persists across panels
  const activeAccordionPanels = ref<string[]>([]);

  function openAuthModal(initialMode: "login" | "signup" = "login") {
    authModalInitialMode.value = initialMode;
    authModalVisible.value = true;
  }

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

  // Shared overlay edit dialog actions, used by both sidemenu and detail panel
  function openOverlayEditDialog(overlay: OverlayEditTarget) {
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

  function openShapeEditor(project: Project, reopen = false) {
    shapeEditor.value = { project, reopen };
  }

  function closeShapeEditor() {
    shapeEditor.value = { project: null, reopen: false };
  }

  return {
    authModalVisible,
    authModalInitialMode,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    hasUnacknowledgedModeratedContributions,
    projectDialog,
    projectEditForm,
    overlayEditDialog,
    activeTab,
    mobileDrawerHeightPercent,
    imageUploadDialog,
    shapeEditor,
    activeAccordionPanels,

    openAuthModal,
    openProjectDialog,
    closeProjectDialog,
    openProjectEditForm,
    closeProjectEditForm,
    openOverlayEditDialog,
    closeOverlayEditDialog,
    openImageUploadDialog,
    closeImageUploadDialog,
    openShapeEditor,
    closeShapeEditor,
  };
});

// eslint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
