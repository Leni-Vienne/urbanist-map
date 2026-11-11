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
        @close="dismissedMaintenanceDay = now.toISOString().slice(0, 10)"
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
        v-if="editingTarget.type === 'overlay-info'"
        :key="editingTarget.overlayId"
        :overlay-id="editingTarget.overlayId"
      />

      <!-- Hover preview card, always mounted so it can show before any detail panel is opened -->
      <HoverPreviewCard />

      <!-- Shape Editor Panel - lives in the map column so it stays centered on the map. -->
      <ShapeEditorPanel
        v-if="editingTarget.type === 'shape'"
        :key="editingTarget.projectId"
        :project-id="editingTarget.projectId"
        @done="handleShapesDone"
        @cancel="uiStore.closeEditor('shape')"
      />
    </div>

    <ProjectManager
      v-if="
        editingTarget.type === 'create-project' ||
        editingTarget.type === 'place-project' ||
        editingTarget.type === 'project-info'
      "
    />

    <ImageUploadDialog
      v-if="editingTarget.type === 'image'"
      :key="editingTarget.projectId + ':' + editingTarget.replacesOverlayId"
      :target="editingTarget"
    />

    <SubmissionDialogWrapper v-if="showSubmissionDialog" />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useSubmissionStore } from "@/stores/submissionStore";
import { toastSuccess, toastError } from "@/services/core/toast";

import { onMounted, ref, onUnmounted, computed, defineAsyncComponent } from "vue";

import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";

import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
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
const dismissedMaintenanceDay = ref<string | null>(null);
const now = ref(new Date());
const maintenanceBannerDismissed = computed(
  () => dismissedMaintenanceDay.value === now.value.toISOString().slice(0, 10),
);
let maintenanceTickInterval: ReturnType<typeof globalThis.setInterval> | undefined = undefined;

const authStore = useAuthStore();
const uiStore = useUiStore();
const { editingTarget } = storeToRefs(uiStore);
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

function handleShapesDone(geometry: GeoJSON.GeometryCollection) {
  if (editingTarget.value.type !== "shape") return;
  const projectId = editingTarget.value.projectId;
  const project = projectStore.projects[projectId];
  if (!project) return;
  projectStore.updateProjectDraft(projectId, { geometry });
  uiStore.closeEditor("shape");
  toastSuccess(t("shapes.savedLocally"));
}

const viewController = new AbortController();

onMounted(() => {
  maintenanceTickInterval = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);

  void restoreSessionAndConsumeAuthParams();
});

async function restoreSessionAndConsumeAuthParams() {
  await authStore.initialize();
  if (viewController.signal.aborted) return;

  if (route.query.auth === "success") {
    if (route.query.provider === "osm" || route.query.provider === "google") {
      authStore.setLastUsedMethod(route.query.provider);
    }
  } else if (typeof route.query.error === "string") {
    const errorMessage = getErrorMessage(route.query.error);
    toastError(errorMessage, t("pages.home.authenticationError"));
  }

  // Fire-and-forget: the deep-link handler waits for the map to be ready on its own.
  void handleProjectDeepLink(route.params.slug, t, viewController.signal);

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
    case "access_denied":
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
  viewController.abort();
  if (maintenanceTickInterval !== undefined) {
    globalThis.clearInterval(maintenanceTickInterval);
  }
});
</script>
