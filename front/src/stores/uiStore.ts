import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import type { PanelTab } from "@/types/index";
import type { AppMode } from "@shared/types";
import { useAuthStore } from "@/stores/authStore";
import { useSubmissionStore } from "@/stores/submissionStore";

export const DEFAULT_MOBILE_DRAWER_HEIGHT_PERCENT = 40;

export type ProjectCoordinates = { lat: number; lng: number };
export type EditingTarget =
  | { type: "none" }
  | { type: "place-project"; coordinates: ProjectCoordinates | null }
  | { type: "create-project"; coordinates: ProjectCoordinates }
  | { type: "project-info"; projectId: string }
  | { type: "overlay-info"; overlayId: string }
  | { type: "image"; projectId: string; replacesOverlayId: string | null }
  | { type: "shape"; projectId: string };

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
  // One edit surface owns its target. Opening another surface retires the previous one.
  const editingTarget = shallowRef<EditingTarget>({ type: "none" });
  // Shared tab state between desktop SideMenu and mobile MobileDrawer
  const activeTab = ref<PanelTab>("explore");
  const mode = computed<AppMode>(() => {
    const panelMode = PANEL_MODES[activeTab.value];
    if (panelMode === "edit" && !authStore.isAuthenticated) return "view";
    if (panelMode === "moderation" && !authStore.isModerator) return "view";
    return panelMode;
  });
  const mobileDrawerHeightPercent = ref(DEFAULT_MOBILE_DRAWER_HEIGHT_PERCENT);

  // Shared accordion state that persists across panels
  const activeAccordionPanels = ref<string[]>([]);

  function openEditor(target: Exclude<EditingTarget, { type: "none" }>): boolean {
    const submission = useSubmissionStore();
    if (mode.value !== "edit" || submission.isSubmitting || submission.showSubmissionDialog)
      return false;
    editingTarget.value = target;
    return true;
  }

  function closeEditor(type: EditingTarget["type"]): void {
    if (editingTarget.value.type === type) editingTarget.value = { type: "none" };
  }

  watch(
    [mode, () => authStore.user?.id],
    ([nextMode, userId], [_previousMode, previousUserId]) => {
      if (nextMode !== "edit" || userId !== previousUserId) editingTarget.value = { type: "none" };
    },
    { flush: "sync" },
  );

  function openAuthModal(initialMode: "login" | "signup" = "login") {
    authModalInitialMode.value = initialMode;
    authModalVisible.value = true;
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
    editingTarget.value = { type: "none" };
    activeAccordionPanels.value = [];
  }

  return {
    authModalVisible,
    authModalInitialMode,
    editingTarget,
    activeTab,
    mode,
    mobileDrawerHeightPercent,
    activeAccordionPanels,

    openAuthModal,
    openEditor,
    closeEditor,
    setMode,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
}
