import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Project, OverlayObject, PanelTab } from "@/types/index";

// Minimal overlay data needed to open the edit dialog (caption editor only)
export type OverlayEditTarget = Pick<OverlayObject, "id" | "caption">;
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

interface ShapeEditorState {
  project: Project | null;
  reopenAt: { lat: number; lng: number } | null;
}

export const useUiStore = defineStore("ui", () => {
  // Dialog visibility states
  const authModalVisible = ref(false);
  const authModalInitialMode = ref<"login" | "signup">("login");
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);

  // Badge indicator, set by ModeratedContributionsWatcher so UserMenu never imports the composable
  const hasUnacknowledgedModeratedContributions = ref(false);

  // Project dialog state
  const projectDialog = ref<ProjectDialogState>({
    visible: false,
  });

  // Edit form states
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
  const mobileDrawerVisible = ref(true); // Open by default on mobile
  const mobileDrawerHeightPercent = ref(40); // Drawer height as percentage of viewport (10-90%)

  // Project info popup state (for standalone projects)
  const projectInfoPopup = ref<ProjectInfoPopupState>({
    visible: false,
    projectId: null,
    project: null,
  });

  // Image upload dialog state
  const imageUploadDialog = ref<ImageUploadDialogState>({
    visible: false,
    projectId: null,
  });

  // Shape editor state
  const shapeEditor = ref<ShapeEditorState>({ project: null, reopenAt: null });

  // Post-login callback - stores action to execute after successful login
  const postLoginCallback = ref<(() => void) | null>(null);

  // Project dialog actions
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

  // Project edit form actions
  function openProjectEditForm(project: Project) {
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

  // Shared overlay edit dialog actions - used by both sidemenu and info popup
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

  // Project info popup actions
  function openProjectInfoPopup(projectId: string, project?: Project) {
    projectInfoPopup.value = {
      visible: true,
      projectId,
      project: project ?? null,
    };
  }

  function closeProjectInfoPopup() {
    projectInfoPopup.value = {
      visible: false,
      projectId: null,
      project: null,
    };
  }

  // Image upload dialog actions
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

  // Shape editor actions
  function openShapeEditor(project: Project, reopenAt?: { lat: number; lng: number }) {
    shapeEditor.value = { project, reopenAt: reopenAt ?? null };
  }

  function closeShapeEditor() {
    shapeEditor.value = { project: null, reopenAt: null };
  }

  function executePostLoginCallback() {
    if (postLoginCallback.value) {
      postLoginCallback.value();
      postLoginCallback.value = null;
    }
  }

  return {
    // State
    authModalVisible,
    authModalInitialMode,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    hasUnacknowledgedModeratedContributions,
    projectDialog,
    projectEditForm,
    overlayEditDialog,
    activeTab,
    mobileDrawerVisible,
    mobileDrawerHeightPercent,
    projectInfoPopup,
    imageUploadDialog,
    shapeEditor,
    postLoginCallback,

    // Actions
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
    openShapeEditor,
    closeShapeEditor,
    executePostLoginCallback,
  };
});

// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
