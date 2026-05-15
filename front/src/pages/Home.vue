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

      <!-- Scheduled maintenance banner (daily 4:00 UTC, ~1 min downtime) -->
      <Message
        v-if="maintenanceBannerText && !maintenanceBannerDismissed"
        severity="warn"
        :closable="true"
        @close="maintenanceBannerDismissed = true"
        class="shrink-0 m-0 rounded-none!"
        icon="pi pi-exclamation-triangle"
      >
        {{ maintenanceBannerText }}
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

      <!-- Hover preview card, always mounted so it can show before any popup is opened -->
      <HoverPreviewCard />
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
      @suggest-tags="handleSuggestTags"
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
import { selectProject } from "@/services/map/standaloneProjectMarkers";
import { createProjectInfoTeleportTargetAtLatLng } from "@/services/map/projectPopupTeleport";
import { clearProjectShapes, renderProjectShapes } from "@/services/map/shapeRendering";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/overlaySelection";

import MapView from "@/components/map/MapView.vue";
import SideMenu from "@/components/layout/SideMenu.vue";
import MobileDrawer from "@/components/layout/MobileDrawer.vue";
import HoverPreviewCard from "@/components/map/popups/HoverPreviewCard.vue";

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

const desktopSideMenuOpen = ref(true);
const infoBannerDismissed = ref(false);
const maintenanceBannerDismissed = ref(false);
const now = ref(new Date());
let maintenanceTickInterval: ReturnType<typeof globalThis.setInterval> | undefined = undefined;

const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const uiStore = useUiStore();
const mapStore = useMapStore();
const projectStore = useProjectStore();
const toast = useToast();
const route = useRoute();
const { t } = useI18n();

// Window: 30 min before 4:00 UTC through the end of the 15 min maintenance
const MAINTENANCE_START_MIN = 4 * 60;
const MAINTENANCE_END_MIN = MAINTENANCE_START_MIN + 15;
const MAINTENANCE_WINDOW_OPEN_MIN = MAINTENANCE_START_MIN - 30;
const MAINTENANCE_WINDOW_CLOSE_MIN = MAINTENANCE_END_MIN;

function formatMaintenanceEndTime(reference: Date): string {
  const end = new Date(reference);
  const endHours = Math.floor(MAINTENANCE_END_MIN / 60);
  const endMinutes = MAINTENANCE_END_MIN % 60;
  end.setUTCHours(endHours, endMinutes, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(end);
}

const maintenanceBannerText = computed(() => {
  const n = now.value;
  const utcMin = n.getUTCHours() * 60 + n.getUTCMinutes();
  if (utcMin < MAINTENANCE_WINDOW_OPEN_MIN || utcMin >= MAINTENANCE_WINDOW_CLOSE_MIN) {
    return null;
  }
  const minutesUntil = MAINTENANCE_START_MIN - utcMin;
  if (minutesUntil > 0) {
    return t("pages.home.maintenance.upcoming", { minutes: minutesUntil });
  }
  return t("pages.home.maintenance.ongoing", { endTime: formatMaintenanceEndTime(n) });
});

// Reset dismissal once the window closes so the banner re-appears the next day
watch(maintenanceBannerText, (value) => {
  if (value === null) maintenanceBannerDismissed.value = false;
});

// Discard in-progress shape edits when leaving edit mode.
// Handled here rather than in useViewportTriggers since that composable has no access to the lazy shapeEditing chunk.
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

const mobileSideMenuOpen = computed({
  get: () => uiStore.mobileDrawerVisible,
  set: (value) => {
    uiStore.mobileDrawerVisible = value;
  },
});

const windowWidth = ref(typeof globalThis !== "undefined" ? globalThis.innerWidth : 1024);
const isMobile = computed(() => windowWidth.value <= 768);

function updateWindowWidth() {
  windowWidth.value = globalThis.innerWidth;
}

async function handleShapesDone(geometry: GeoJSON.GeometryCollection) {
  const project = uiStore.shapeEditor.project;
  const reopenAt = uiStore.shapeEditor.reopenAt;
  if (!project) return;
  // Ensure the project is in the store so updateProject doesn't fall back to a default with null status.
  if (!projectStore.projects[project.id]) {
    projectStore.projects = { ...projectStore.projects, [project.id]: project };
  }
  projectStore.updateProject(project.id, { geometry, isModified: true });
  const { destroyShapeEditor } = await import("@/services/shape/shapeEditing");
  destroyShapeEditor(map.value);
  // Re-render updated shapes immediately (Geoman layers were just removed by destroyShapeEditor,
  // and the viewport loop only covers backend overlays).
  clearProjectShapes(project.id);
  if (geometry.geometries.length > 0) {
    const updatedProject = projectStore.projects[project.id] ?? { ...project, geometry };
    renderProjectShapes(
      updatedProject,
      map.value,
      selectProject,
      highlightProject,
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

function handleSuggestTags(suggestedTags: string[]) {
  const project = uiStore.shapeEditor.project;
  if (!project) return;
  const existing = project.tags ?? [];
  const merged = [...new Set([...existing, ...suggestedTags])];
  projectStore.updateProject(project.id, { tags: merged, isModified: true });
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
  globalThis.addEventListener("resize", updateWindowWidth);
  maintenanceTickInterval = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);

  overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

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
});

// Get error message for auth query param codes
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
  if (maintenanceTickInterval !== undefined) {
    globalThis.clearInterval(maintenanceTickInterval);
  }

  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.height = "";
});
</script>
