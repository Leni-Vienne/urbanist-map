<template>
  <div class="flex h-screen">
    <SideMenu v-if="!isMobile" />

    <MobileDrawer v-if="isMobile" />

    <div class="grow flex flex-col relative">
      <Message
        v-if="authStore.infoMessage && !authStore.version && !infoBannerDismissed"
        severity="info"
        :closable="true"
        @close="infoBannerDismissed = true"
        class="shrink-0 m-0 rounded-none!"
        icon="pi pi-info-circle"
      >
        {{ authStore.infoMessage }}
      </Message>

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

      <div class="flex-1 relative overflow-hidden">
        <MapView />
      </div>

      <!-- Overlay caption editor, opened from the docked project detail (store-driven). -->
      <OverlayEditor
        v-if="uiStore.mode === 'edit' && uiStore.overlayEditTargetId"
        :key="uiStore.overlayEditTargetId"
      />

      <!-- Hover preview card, always mounted so it can show before any detail panel is opened -->
      <HoverPreviewCard />

      <!-- Shape Editor Panel - lives in the map column so it stays centered on the map. -->
      <ShapeEditorPanel
        v-if="uiStore.shapeEditorProjectId"
        :key="uiStore.shapeEditorProjectId"
        @done="handleShapesDone"
        @cancel="stopShapeEditing"
      />
    </div>

    <ProjectManager
      v-if="
        uiStore.projectCreationSeed ||
        uiStore.markerPlacementBarVisible ||
        uiStore.projectEditTargetId
      "
    />

    <ImageUploadDialog
      v-if="uiStore.imageUploadProjectId"
      :key="uiStore.imageUploadProjectId + ':' + uiStore.replacementOverlayId"
    />

    <SubmissionDialogWrapper v-if="showSubmissionDialog" />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useSubmissionStore } from "@/stores/submissionStore";
import { toastSuccess, toastError } from "@/services/core/toast";

import { onMounted, ref, onUnmounted, computed, defineAsyncComponent, watch } from "vue";

import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";

import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  stopShapeEditing,
  startShapeEditing,
  disposeShapeEditing,
} from "@/services/shape/shapeEditorLazy";

import { handleProjectDeepLink } from "@/services/project/projectDeepLink";
import { isMobile } from "@/services/core/viewport";

import MapView from "@/components/map/MapView.vue";
import SideMenu from "@/components/layout/SideMenu.vue";
import MobileDrawer from "@/components/layout/MobileDrawer.vue";
import HoverPreviewCard from "@/components/map/popups/HoverPreviewCard.vue";

const OverlayEditor = defineAsyncComponent(() => import("@/components/map/OverlayEditor.vue"));
const ShapeEditorPanel = defineAsyncComponent(
  () => import("@/components/map/ShapeEditorPanel.vue"),
);
const ProjectManager = defineAsyncComponent(
  () => import("@/components/project/ProjectManager.vue"),
);
const ImageUploadDialog = defineAsyncComponent(
  () => import("@/components/common/ImageUploadDialog.vue"),
);
// Keep the submission-service imports behind this async boundary until a submission is triggered.
const SubmissionDialogWrapper = defineAsyncComponent(
  () => import("@/components/submission/SubmissionDialogWrapper.vue"),
);

const { showSubmissionDialog } = storeToRefs(useSubmissionStore());

const infoBannerDismissed = ref(false);
const maintenanceBannerDismissed = ref(false);
const now = ref(new Date());
let maintenanceTickInterval: ReturnType<typeof globalThis.setInterval> | undefined = undefined;

const authStore = useAuthStore();
const uiStore = useUiStore();
const projectStore = useProjectStore();

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

// The selected edit surface owns activation, including cancellation during lazy loading.
watch(
  () => uiStore.editingTarget,
  (target, _previous, onCleanup) => {
    if (target.type !== "shape") return;
    onCleanup(disposeShapeEditing);
    void startShapeEditing(target.projectId).catch((error: unknown) => {
      if (uiStore.editingTarget !== target) return;
      uiStore.closeShapeEditor();
      toastError(error instanceof Error ? error.message : t("shapes.importError"));
    });
  },
  { immediate: true, flush: "sync" },
);

function handleShapesDone(geometry: GeoJSON.GeometryCollection) {
  const projectId = uiStore.shapeEditorProjectId;
  if (!projectId) return;
  const project = projectStore.projects[projectId];
  if (!project) return;
  projectStore.updateProjectDraft(projectId, { geometry });
  stopShapeEditing();
  toastSuccess(t("shapes.savedLocally"));
}

onMounted(() => {
  maintenanceTickInterval = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);

  void restoreSessionAndConsumeAuthParams();
});

async function restoreSessionAndConsumeAuthParams() {
  await authStore.initialize();

  if (route.query.auth === "success") {
    if (route.query.provider === "osm") {
      authStore.setLastUsedMethod("osm");
    }
  } else if (route.query.error) {
    const errorMessage = getErrorMessage(route.query.error as string);
    toastError(errorMessage, t("pages.home.authenticationError"));
  }

  // Fire-and-forget: the deep-link handler waits for the map to be ready on its own.
  void handleProjectDeepLink(route.params.slug, t);

  // Strip the auth params the OAuth callback appended so they don't linger in the URL.
  // Done via the History API to leave the map-state hash (managed in map.ts) untouched.
  if (route.query.auth || route.query.error || route.query.provider) {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("auth");
    url.searchParams.delete("provider");
    url.searchParams.delete("error");
    const path = url.pathname.replace(/\/{2,}/g, "/");
    globalThis.history.replaceState(globalThis.history.state, "", path + url.search + url.hash);
  }
}

function getErrorMessage(error: string): string {
  switch (error) {
    case "auth_failed":
      return t("pages.home.errors.authenticationFailed");
    case "no_session":
      return t("pages.home.errors.signInCancelled");
    case "unexpected":
      return t("pages.home.errors.unexpectedError");
    case "too_many_requests":
      return t("auth.error.tooManyRequests");
    default:
      return t("pages.home.errors.authenticationError");
  }
}

onUnmounted(() => {
  if (maintenanceTickInterval !== undefined) {
    globalThis.clearInterval(maintenanceTickInterval);
  }
});
</script>
