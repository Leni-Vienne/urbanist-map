import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Project, PanelTab } from "@/types/index";
import type { AppMode } from "@shared/types";
import { useAuthStore } from "@/stores/authStore";

const PANEL_MODES = {
  explore: "view",
  filter: "view",
  contribute: "edit",
  moderation: "moderation",
} satisfies Record<PanelTab, AppMode>;

const MODE_PANELS = {
  view: "explore",
  edit: "contribute",
  moderation: "moderation",
} satisfies Record<AppMode, PanelTab>;

export const useUiStore = defineStore("ui", () => {
  const authStore = useAuthStore();
  const authModalVisible = ref(false);
  const authModalInitialMode = ref<"login" | "signup">("login");
  const markerPlacementBarVisible = ref(false);
  const moderatedContributionsDialogVisible = ref(false);

  const projectCreationSeed = ref<Pick<Project, "lat" | "lng"> | null>(null);
  const projectEditTargetId = ref<string | null>(null);
  const overlayEditTargetId = ref<string | null>(null);

  // Shared tab state between desktop SideMenu and mobile MobileDrawer
  const activeTab = ref<PanelTab>("explore");
  const mode = computed<AppMode>(() => {
    const panelMode = PANEL_MODES[activeTab.value];
    if (panelMode === "edit" && !authStore.isAuthenticated) return "view";
    if (panelMode === "moderation" && !authStore.isModerator) return "view";
    return panelMode;
  });
  const mobileDrawerHeightPercent = ref(40);

  const imageUploadProjectId = ref<string | null>(null);
  const shapeEditorProjectId = ref<string | null>(null);

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

  function openProjectEditForm(projectId: string) {
    projectEditTargetId.value = projectId;
  }

  function closeProjectEditForm() {
    projectEditTargetId.value = null;
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

  function openShapeEditor(projectId: string) {
    shapeEditorProjectId.value = projectId;
  }

  function closeShapeEditor() {
    shapeEditorProjectId.value = null;
  }

  // Modes are panel identities. Explore is the default destination for view mode; switching
  // between Explore and Filter keeps the map in view mode.
  function setMode(targetMode: AppMode) {
    if (PANEL_MODES[activeTab.value] !== targetMode) activeTab.value = MODE_PANELS[targetMode];
  }

  // Reset the state scoped to the signed-in user: the active tab (which the map mode derives from),
  // every panel and dialog, and their targets. Viewport preferences are left alone.
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
    projectEditTargetId,
    overlayEditTargetId,
    activeTab,
    mode,
    mobileDrawerHeightPercent,
    imageUploadProjectId,
    shapeEditorProjectId,
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
    setMode,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
