<template>
  <div class="flex h-screen">
    <!-- Desktop SideMenu -->
    <SideMenu
      v-if="!isMobile"
      :is-open="desktopSideMenuOpen"
      :is-moderator="authStore.isModerator"
      @close="() => (desktopSideMenuOpen = false)"
    />

    <!-- Mobile Bottom Drawer -->
    <MobileDrawer v-if="isMobile" v-model:visible="mobileSideMenuOpen" />

    <div class="grow flex flex-col relative">
      <!-- Info message banner (displayed at top when config.infoMessage is set) -->
      <Message
        v-if="authStore.infoMessage && !infoBannerDismissed"
        severity="info"
        :closable="true"
        @close="infoBannerDismissed = true"
        class="shrink-0 m-0 rounded-none!"
        icon="pi pi-info-circle"
      >
        {{ authStore.infoMessage }}
      </Message>

      <!-- Map container that fills remaining space -->
      <div class="flex-1 relative overflow-hidden">
        <MapView />
      </div>

      <!-- Popup container handles both overlay and project popups, AND the shared overlay edit dialog -->
      <PopupContainer
        v-if="
          overlayStore.showInfoPopup ||
          uiStore.projectInfoPopup.visible ||
          uiStore.overlayEditDialog.visible
        "
      />
    </div>

    <!-- Project Management Dialogs -->
    <ProjectManager
      v-if="
        uiStore.projectDialog.visible ||
        uiStore.markerPlacementBarVisible ||
        uiStore.projectEditForm.visible
      "
    />

    <!-- Image Upload Dialog - always rendered so it's available from any part of the app -->
    <ImageUploadDialog v-if="uiStore.imageUploadDialog.visible" />

    <!-- Submission Confirmation Dialog - loads lazily when first submission is triggered -->
    <SubmissionDialogWrapper v-if="uiStore.submissionDialogVisible" />

    <!-- Shape Editor Panel - lives outside PopupContainer so closing a popup doesn't destroy it -->
    <ShapeEditorPanel
      v-if="uiStore.shapeEditor.project"
      @done="handleShapesDone"
      @cancel="handleShapesCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, onUnmounted, computed, defineAsyncComponent, watch } from "vue";

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
import { useToast } from "@/composables/ui/useToast";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { handleShapeProjectClick } from "@/services/map/standaloneProjectMarkers";
import { createProjectInfoTeleportTargetAtLatLng } from "@/services/map/projectPopupTeleport";
import { clearProjectShapes, renderProjectShapes } from "@/services/map/shapeRendering";
import {
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";

import MapView from "@/components/map/MapView.vue";
import SideMenu from "@/components/layout/SideMenu.vue";
import MobileDrawer from "@/components/layout/MobileDrawer.vue";

// Split PopupContainer into separate chunk - loads when first popup is shown
const PopupContainer = defineAsyncComponent(() => import("@/components/map/PopupContainer.vue"));
const ShapeEditorPanel = defineAsyncComponent(
  () => import("@/components/map/ShapeEditorPanel.vue"),
);
const ProjectManager = defineAsyncComponent(
  () => import("@/components/project/ProjectManager.vue"),
);
const ImageUploadDialog = defineAsyncComponent(
  () => import("@/components/common/ImageUploadDialog.vue"),
);
// Loads lazily the first time a submission is triggered (not on page load)
const SubmissionDialogWrapper = defineAsyncComponent(
  () => import("@/components/submission/SubmissionDialogWrapper.vue"),
);

// Create refs to track app state
const desktopSideMenuOpen = ref(true); // Open by default on desktop
const infoBannerDismissed = ref(false);
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const uiStore = useUiStore();
const mapStore = useMapStore();
const projectStore = useProjectStore();
const toast = useToast();
const route = useRoute();
const { t } = useI18n();

// Discard in-progress shape edits when leaving edit mode (e.g. switching to view mode).
// The mode watcher in useViewportTriggers handles overlay cleanup but has no access to
// the lazy shapeEditing chunk — so we handle it here where the other shape callbacks live.
watch(
  () => mapStore.mode,
  async (newMode, oldMode) => {
    if (oldMode === "edit" && newMode !== "edit" && uiStore.shapeEditor.project) {
      const { destroyShapeEditor } = await import("@/services/shape/shapeEditing");
      destroyShapeEditor(map.value);
      uiStore.closeShapeEditor();
    }
  },
);

// Use mobile drawer state from UI store
const mobileSideMenuOpen = computed({
  get: () => uiStore.mobileDrawerVisible,
  set: (value) => {
    uiStore.mobileDrawerVisible = value;
  },
});

// Mobile detection for responsive drawer behavior
const windowWidth = ref(typeof globalThis !== "undefined" ? globalThis.innerWidth : 1024);
const isMobile = computed(() => windowWidth.value <= 768);

// Update window width on resize
function updateWindowWidth() {
  windowWidth.value = globalThis.innerWidth;

  // Update mobile overflow constraints when window size changes
  if (isMobile.value) {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    document.body.style.height = "100dvh";
  } else {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.height = "";
  }
}

async function handleShapesDone(geometry: GeoJSON.GeometryCollection) {
  const project = uiStore.shapeEditor.project;
  const reopenAt = uiStore.shapeEditor.reopenAt;
  if (!project) return;
  // Ensure the project is in the store before the targeted update — it may only exist in
  // popup state (e.g. approved-shape projects opened via shape click, never stored locally).
  // Without this, updateProject falls back to createProjectObject which defaults status to null.
  if (!projectStore.projects[project.id]) {
    projectStore.projects = { ...projectStore.projects, [project.id]: project };
  }
  projectStore.updateProject(project.id, { geometry, isModified: true });
  const { destroyShapeEditor } = await import("@/services/shape/shapeEditing");
  destroyShapeEditor(map.value);
  // Re-render updated shapes immediately. Geoman layers were just removed by destroyShapeEditor,
  // and the viewport loop only covers backend overlays — pending/local shapes need explicit rendering.
  clearProjectShapes(project.id);
  if (geometry.geometries.length > 0) {
    const updatedProject = projectStore.projects[project.id] ?? { ...project, geometry };
    renderProjectShapes(
      updatedProject,
      map.value,
      handleShapeProjectClick,
      highlightProjectOverlaysOnHover,
      removeProjectOutlines,
    );
  }
  uiStore.closeShapeEditor();
  toast.add({ severity: "success", summary: t("shapes.savedLocally"), life: 3000 });
  if (reopenAt) {
    uiStore.openProjectInfoPopup(project.id, project);
    const leafletModule = await import("leaflet");
    const L = leafletModule.default;
    createProjectInfoTeleportTargetAtLatLng(L.latLng(reopenAt.lat, reopenAt.lng));
  }
}

async function handleShapesCancel() {
  const project = uiStore.shapeEditor.project;
  const reopenAt = uiStore.shapeEditor.reopenAt;
  const { destroyShapeEditor } = await import("@/services/shape/shapeEditing");
  destroyShapeEditor(map.value);
  uiStore.closeShapeEditor();
  if (reopenAt && project) {
    uiStore.openProjectInfoPopup(project.id, project);
    const leafletModule = await import("leaflet");
    const L = leafletModule.default;
    createProjectInfoTeleportTargetAtLatLng(L.latLng(reopenAt.lat, reopenAt.lng));
  }
}

onMounted(async () => {
  // Add window resize listener for mobile detection
  globalThis.addEventListener("resize", updateWindowWidth);

  // Preload PopupContainer chunk on page load. Not needed on page load but improves responsiveness when first popup is shown
  //import("@/components/map/PopupContainer.vue");

  // Prevent page scrolling on mobile to avoid viewport issues
  if (isMobile.value) {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    document.body.style.height = "100dvh"; // Use dynamic viewport where supported
  }

  // Update overlayStore to use the new UI store for dialog control
  overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

  try {
    await authStore.initialize();

    // Handle auth query parameters from URL
    if (route.query.auth === "success") {
      toast.add({
        severity: "success",
        summary: t("common.success"),
        detail: t("pages.home.signInSuccess"),
        life: 3000,
      });
    } else if (route.query.error) {
      const errorMessage = getErrorMessage(route.query.error as string);
      toast.add({
        severity: "error",
        summary: t("pages.home.authenticationError"),
        detail: errorMessage,
        life: 5000,
      });
    }
  } catch (error) {
    console.error("Error during application initialization:", error);
  }
});

// Get user-friendly error messages
function getErrorMessage(error: string): string {
  switch (error) {
    case "auth_failed":
      return t("pages.home.errors.authenticationFailed");
    case "no_session":
      return t("pages.home.errors.signInCancelled");
    case "unexpected":
      return t("pages.home.errors.unexpectedError");
    default:
      return t("pages.home.errors.authenticationError");
  }
}

onUnmounted(() => {
  globalThis.removeEventListener("resize", updateWindowWidth);

  // Restore normal overflow behavior when component unmounts
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.height = "";
});
</script>
