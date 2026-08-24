import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Project, PanelTab } from "@/types/index";

export const useUiStore = defineStore("ui", () => {
  const authModalVisible = ref(false);
  const authModalInitialMode = ref<"login" | "signup">("login");
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);

  const projectCreationSeed = ref<Pick<Project, "lat" | "lng"> | null>(null);
  const projectEditTarget = ref<Project | null>(null);
  const overlayEditTargetId = ref<string | null>(null);

  // Shared tab state between desktop SideMenu and mobile MobileDrawer
  const activeTab = ref<PanelTab>("explore");
  const mobileDrawerHeightPercent = ref(40);

  const imageUploadProjectId = ref<string | null>(null);
  const shapeEditorProject = ref<Project | null>(null);

  // Shared accordion state that persists across panels
  const activeAccordionPanels = ref<string[]>([]);

  function openAuthModal(initialMode: "login" | "signup" = "login") {
    authModalInitialMode.value = initialMode;
    authModalVisible.value = true;
  }

  function openProjectDialog(project: Pick<Project, "lat" | "lng">) {
    projectCreationSeed.value = project;
  }

  function closeProjectDialog() {
    projectCreationSeed.value = null;
  }

  function openProjectEditForm(project: Project) {
    projectEditTarget.value = project;
  }

  function closeProjectEditForm() {
    projectEditTarget.value = null;
  }

  function openOverlayEditDialog(overlayId: string) {
    overlayEditTargetId.value = overlayId;
  }

  function closeOverlayEditDialog() {
    overlayEditTargetId.value = null;
  }

  function openImageUploadDialog(projectId: string) {
    imageUploadProjectId.value = projectId;
  }

  function closeImageUploadDialog() {
    imageUploadProjectId.value = null;
  }

  function openShapeEditor(project: Project) {
    shapeEditorProject.value = project;
  }

  function closeShapeEditor() {
    shapeEditorProject.value = null;
  }

  // Reset the state scoped to the signed-in user: the active tab (which the map mode derives from),
  // every panel and dialog, and their retained entities. Viewport preferences are left alone.
  function clearAllState() {
    activeTab.value = "explore";
    markerPlacementBarVisible.value = false;
    moderatedContributionsDialogVisible.value = false;
    activeAccordionPanels.value = [];
    closeProjectDialog();
    closeProjectEditForm();
    closeOverlayEditDialog();
    closeImageUploadDialog();
    closeShapeEditor();
  }

  return {
    authModalVisible,
    authModalInitialMode,
    markerPlacementBarVisible,
    moderatedContributionsDialogVisible,
    projectCreationSeed,
    projectEditTarget,
    overlayEditTargetId,
    activeTab,
    mobileDrawerHeightPercent,
    imageUploadProjectId,
    shapeEditorProject,
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
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
