<template>
  <div class="flex flex-col h-full min-h-0 bg-content-background">
    <!-- Back header: returns to the panel's tab content -->
    <button
      type="button"
      class="flex items-center gap-2 px-4 py-2.5 border-b border-surface text-sm font-medium text-muted-color hover:text-color hover:bg-content-hover-background cursor-pointer bg-transparent shrink-0 text-left"
      @click="handleBack"
    >
      <i class="pi pi-arrow-left text-xs"></i>
      {{ $t("common.back") }}
    </button>

    <div v-if="!project" class="flex-1 flex justify-center items-center p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <template v-else>
      <!-- Project header: project name + action buttons -->
      <div class="px-4 pt-3 pb-2 border-b border-surface shrink-0">
        <div :class="['flex gap-2', overlay ? 'items-start' : 'items-center']">
          <!-- Left: project name stacked above overlay subtitle -->
          <div class="flex-1 flex flex-col gap-0.5 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <!-- Wikidata logo (e.g. metro line badge) shown when available -->
              <img
                v-if="wikidataEntity?.logoUrl"
                :src="wikidataEntity.logoUrl"
                class="w-5 h-5 object-contain shrink-0"
                referrerpolicy="no-referrer"
                loading="eager"
              />
              <span
                class="text-sm font-semibold leading-snug wrap-break-word"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{ project?.name || $t("project.unnamed") }}
              </span>
            </div>
            <!-- Overlay subtitle: image name or untitled + text "modifier" link -->
            <div v-if="overlay" class="flex items-baseline gap-1.5">
              <span class="text-xs italic text-muted-color leading-snug">
                {{ overlay.caption || $t("overlay.untitled") }}
              </span>
              <button
                v-if="!viewMode && user"
                type="button"
                class="text-xs italic text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 cursor-pointer bg-transparent border-none p-0 outline-none shrink-0"
                @click="handleEditOverlay(overlay)"
              >
                {{ $t("common.edit") }}
              </button>
              <button
                v-if="
                  !viewMode && user && overlay.status === 'pending' && overlay.authorId === user.id
                "
                type="button"
                class="text-xs italic text-red-400 hover:text-red-600 dark:hover:text-red-300 cursor-pointer bg-transparent border-none p-0 outline-none shrink-0"
                @click="handleDeleteOverlay(overlay)"
              >
                {{ $t("common.delete") }}
              </button>
            </div>
          </div>
          <!-- Right: project action buttons -->
          <div class="flex gap-1 shrink-0">
            <!-- Edit button (owned = direct edit, non-owned = suggest changes) -->
            <button
              v-if="!viewMode && project && user"
              type="button"
              :aria-label="
                project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')
              "
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-primary-200"
              @click="handleEditProject(project)"
              v-tooltip.top="
                project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')
              "
            >
              <i class="pi pi-pencil"></i>
            </button>
            <!-- Delete button (for unsubmitted projects or pending projects owned by user) -->
            <button
              v-if="canDeleteProject"
              type="button"
              :aria-label="$t('contribute.deleteProject')"
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
              @click="handleDeleteProject(project)"
              v-tooltip.top="$t('contribute.deleteProject')"
            >
              <i class="pi pi-trash"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Project fields + overlay section -->
      <div class="px-4 pt-3 pb-4 flex-1 overflow-y-auto overscroll-contain">
        <ProjectMetadataCard
          :project="project"
          :show-name="false"
          :show-description="true"
          :edit-mode="!viewMode"
          @field-click="handleEditProject(project)"
        />

        <!-- Wikidata main image (P18) shown at the bottom of the metadata section. Click to zoom. -->
        <div v-if="wikidataEntity?.imageUrl" class="mt-3 pt-3 border-t border-surface">
          <img
            :src="wikidataEntity.imageUrl"
            class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
            referrerpolicy="no-referrer"
            loading="lazy"
            v-tooltip.top="$t('overlay.viewFullImage')"
            @click="
              openLightbox({
                url: wikidataEntity.imageUrl,
                header: project?.name || $t('project.unnamed'),
                referrerpolicy: 'no-referrer',
              })
            "
          />
        </div>

        <!-- Render (artist's impression): a user-contributed, non-georeferenced project image.
             Added/replaced via the project edit form, not here. Click to view full size. -->
        <div v-if="renderImageUrl" class="mt-3 pt-3 border-t border-surface flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-color">{{ $t("render.label") }}</span>
          <img
            :src="renderImageUrl"
            :crossorigin="renderImageCrossorigin"
            class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
            loading="lazy"
            v-tooltip.top="$t('overlay.viewFullImage')"
            @click="
              openLightbox({
                url: renderImageUrl,
                header: $t('render.label'),
                crossorigin: renderImageCrossorigin,
              })
            "
          />
          <span v-if="stagedRender" class="text-xs italic text-muted-color">
            {{ $t("render.notSubmitted") }}
          </span>
          <span
            v-else-if="renderImage && renderImage.status !== 'approved'"
            class="text-xs italic text-muted-color"
          >
            {{ $t("render.pendingReview") }}
          </span>
        </div>

        <!-- Show view original button for pending replacements -->
        <div
          v-if="overlay?.replacesOverlayId && overlay?.status === 'pending'"
          class="mt-3 pt-3 border-t border-surface"
        >
          <button
            type="button"
            class="inline-flex items-center gap-2 font-medium text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-purple-100 hover:border-purple-300 hover:text-purple-700"
            @click.stop="handleViewOriginalOverlay(overlay.replacesOverlayId)"
          >
            <i class="pi pi-arrow-left text-sm"></i>
            {{ $t("overlay.viewOriginalOverlay") }}
          </button>
        </div>
      </div>

      <!-- Action buttons footer, stays visible while the content above scrolls -->
      <div
        v-if="!viewMode"
        class="px-4 pb-4 pt-2 flex flex-col gap-2 shrink-0 border-t border-surface"
      >
        <div class="flex gap-2">
          <Button
            class="flex-1"
            type="button"
            :label="$t('shapes.drawShapes')"
            severity="secondary"
            outlined
            @click="handleDrawShapesClick"
          >
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="lucide lucide-waypoints-icon lucide-waypoints"
              >
                <path d="m10.586 5.414-5.172 5.172" />
                <path d="m18.586 13.414-5.172 5.172" />
                <path d="M6 12h12" />
                <circle cx="12" cy="20" r="2" />
                <circle cx="12" cy="4" r="2" />
                <circle cx="20" cy="12" r="2" />
                <circle cx="4" cy="12" r="2" />
              </svg>
            </template>
          </Button>
          <Button
            class="flex-1"
            type="button"
            :label="$t('project.addImages')"
            severity="secondary"
            outlined
            @click="handleAddImages"
          >
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M16 5h6" />
                <path d="M19 2v6" />
                <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                <circle cx="9" cy="9" r="2" />
              </svg>
            </template>
          </Button>
        </div>
        <Button
          class="w-full"
          type="button"
          :label="$t('project.submitChangeRequest')"
          icon="pi pi-send"
          severity="success"
          :loading="isSubmitting"
          :disabled="!hasChanges"
          @click="handlePublishClick"
        />
      </div>
    </template>

    <!-- Full-size image lightbox: scroll to zoom (toward cursor), drag to pan, double-click to reset -->
    <Dialog
      v-model:visible="lightboxVisible"
      modal
      dismissableMask
      :draggable="false"
      :header="lightboxImage?.header"
      :style="{ width: 'auto', maxWidth: '90vw' }"
      :pt="{ content: { class: 'p-0' } }"
    >
      <div
        class="overflow-hidden max-h-[80vh] max-w-[90vw] flex items-center justify-center touch-none"
        @wheel.prevent="handleLightboxWheel"
        @pointerdown="handleLightboxPointerDown"
        @pointermove="handleLightboxPointerMove"
        @pointerup="handleLightboxPointerUp"
        @pointerleave="handleLightboxPointerUp"
        @dblclick="resetLightbox"
      >
        <img
          v-if="lightboxImage"
          ref="lightboxImg"
          :src="lightboxImage.url"
          :crossorigin="lightboxImage.crossorigin"
          :referrerpolicy="lightboxImage.referrerpolicy"
          class="block max-h-[80vh] max-w-[90vw] object-contain select-none"
          :class="
            lightboxZoom > 1
              ? isPanningLightbox
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-zoom-in'
          "
          :style="{
            transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom})`,
          }"
          draggable="false"
          alt=""
        />
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { Dialog } from "primevue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import { useToast } from "@/composables/ui/useToast";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useImageLightbox } from "@/composables/ui/useImageLightbox";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { getStagedRender } from "@/composables/submission/stagedRenderStore";

import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";

import { navigateToOverlay } from "@/services/overlay/actions";
import { closeProjectPopupAndResetMarkers } from "@/services/map/standaloneProjectMarkers";
import { startShapeEditing } from "@/services/shape/shapeEditorLazy";

import { isOverlayUnsaved, isProjectUnsaved } from "@/utils/unsavedState";
import { buildImageUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { createProjectObject } from "@/utils/typeFactories";
import { trpc } from "@/client";
import type { OverlayData, OverlayObject, Project } from "@/types/index";

import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t: $t, t } = useI18n();
const toast = useToast();
const { isMobile } = useIsMobile();
const {
  image: lightboxImage,
  zoom: lightboxZoom,
  pan: lightboxPan,
  isPanning: isPanningLightbox,
  visible: lightboxVisible,
  open: openLightbox,
  reset: resetLightbox,
  handleWheel: handleLightboxWheel,
  handlePointerDown: handleLightboxPointerDown,
  handlePointerMove: handleLightboxPointerMove,
  handlePointerUp: handleLightboxPointerUp,
} = useImageLightbox();

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const projectStore = useProjectStore();
const overlayStore = useOverlayStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { projectInfoPopup } = storeToRefs(uiStore);

const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();
const { isSubmitting, prepareOverlaySubmission, prepareSubmission } = useSubmissionDialog();

const viewMode = computed(() => mapStore.mode !== "edit");

const overlay = computed(() => {
  if (
    !showInfoPopup.value ||
    !infoPopupOverlayId.value ||
    !overlays.value[infoPopupOverlayId.value]
  ) {
    return null;
  }
  return overlays.value[infoPopupOverlayId.value];
});

function convertAndCacheBackendProject(
  backendProject: NonNullable<OverlayData["project"]>,
): Project {
  const existing = projects.value[backendProject.id];
  if (existing) return existing;

  const overlayIds = Object.values(overlays.value)
    .filter((o) => o.projectId === backendProject.id)
    .map((o) => o.id);

  const project = createProjectObject({ ...backendProject, overlayIds });
  projects.value = { ...projects.value, [project.id]: project };
  if (project.status !== null) projectStore.cacheProjectBackendState(project.id);

  return project;
}

// In view mode, show original approved data for locally-modified projects.
function getEffectiveProject(projectId: string): Project | undefined {
  const localProject = projects.value[projectId];
  if (!localProject) return undefined;
  if (mapStore.mode !== "edit" && localProject.isModified) {
    const original = projectStore.getOriginalProject(projectId);
    if (original) return original as Project;
  }
  return localProject;
}

const project = computed<Project | undefined>(() => {
  // Check overlay popup first.
  const currentOverlay = overlay.value;
  if (currentOverlay?.projectId) {
    const localProject = getEffectiveProject(currentOverlay.projectId);
    if (localProject) return localProject;

    const backendProject =
      currentOverlay.project?.id === currentOverlay.projectId ? currentOverlay.project : null;
    if (backendProject) return convertAndCacheBackendProject(backendProject);
  }

  // Fall back to project popup.
  if (projectInfoPopup.value.visible && projectInfoPopup.value.projectId) {
    const localProject = getEffectiveProject(projectInfoPopup.value.projectId);
    if (localProject) return localProject;

    if (projectInfoPopup.value.project) return projectInfoPopup.value.project;
  }

  return undefined;
});

// Project render (artist's impression), delivered with the project by project.getById. The backend
// already scopes this to approved or the user's own pending render; we just hide a pending render
// while in view mode (so the live view<->edit toggle is purely a computed, no refetch).
const renderImage = computed(() => project.value?.render ?? null);

// Marker popups load their project via getById (render included), but overlay popups build it from
// the viewport payload, which omits render (undefined). Hydrate that one case via getById.
watch(
  () => project.value?.id,
  async (id) => {
    const current = project.value;
    if (!id || !current || current.status === null || current.render !== undefined) return;
    try {
      const fresh = await trpc.project.getById.query({ id });
      if (fresh) projectStore.updateProject(id, { render: fresh.render ?? null });
    } catch (error) {
      console.error("Failed to hydrate project render:", error);
    }
  },
  { immediate: true },
);

// A render staged through the "Add images" dialog but not yet submitted. View mode shows approved
// content only, so it never surfaces there. Reactive via stagedRenderStore, so it appears the
// moment it is staged and disappears once submission promotes it to project.render.
const stagedRender = computed(() =>
  viewMode.value || !project.value?.id ? null : (getStagedRender(project.value.id) ?? null),
);

const renderImageUrl = computed(() => {
  if (stagedRender.value) return stagedRender.value.previewUrl;
  const render = renderImage.value;
  if (!render) return null;
  if (viewMode.value && render.status !== "approved") return null;
  // Pending renders live in local storage (not yet on R2), so force the backend URL.
  return buildImageUrl(render.filename, render.status !== "approved");
});

const renderImageCrossorigin = computed(() =>
  renderImageUrl.value && imageRequiresCredentials(renderImageUrl.value)
    ? "use-credentials"
    : undefined,
);

// Wikidata entity for the current project (logo, description, height)
const wikidataId = computed(() => {
  const p = project.value?.externalProperties;
  if (!p || typeof p !== "object") return null;
  const id = (p as Record<string, unknown>)["wikidata"];
  return typeof id === "string" ? id : null;
});
const { entity: wikidataEntity } = useWikidataEntity(wikidataId);

const hasChanges = computed(() => {
  if (overlay.value && isOverlayUnsaved(overlay.value)) return true;
  if (project.value && isProjectUnsaved(project.value)) return true;
  return false;
});

const canDeleteProject = computed(() => {
  if (!project.value || !user.value || viewMode.value) return false;
  const isDeletable = project.value.status === null || project.value.status === "pending";
  const isOwner = project.value.ownerId === user.value.id;
  return isDeletable && isOwner;
});

function handlePublishClick() {
  if (overlay.value) {
    prepareOverlaySubmission(overlay.value, project.value);
  } else if (project.value) {
    prepareSubmission(project.value);
  }
}

function handleEditProject(target: Project) {
  uiStore.openProjectEditForm(target);
}

function handleEditOverlay(target: OverlayObject) {
  uiStore.openOverlayEditDialog({ id: target.id, caption: target.caption });
}

function handleAddImages() {
  if (project.value) uiStore.openImageUploadDialog(project.value.id);
}

function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  closeProjectPopupAndResetMarkers();
}

// Back returns to the panel's tab list, closing whichever detail is open.
function handleBack() {
  if (showInfoPopup.value) {
    overlayStore.hideInfoPopup();
  } else {
    closeProjectInfoPopup();
  }
}

async function handleViewOriginalOverlay(originalOverlayId: string) {
  try {
    const success = await navigateToOverlay(originalOverlayId, true);
    if (!success) {
      toast.add({
        severity: "error",
        summary: t("overlay.navigationFailed"),
        detail: t("overlay.failedToNavigate"),
        life: 3000,
      });
    }
  } catch (error) {
    console.error("Failed to navigate to original overlay:", error);
    toast.add({
      severity: "error",
      summary: t("overlay.navigationFailed"),
      detail: error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      life: 3000,
    });
  }
}

async function handleDeleteOverlay(target: OverlayObject) {
  const currentProject = project.value;
  const projectId = currentProject?.id;

  const overlayCount = projectId
    ? Object.values(overlays.value).filter((o) => o.projectId === projectId).length
    : 0;

  await deleteOverlayWithMarker(target.id, currentProject, overlayCount, target.caption, () => {
    overlayStore.hideInfoPopup();
  });
}

async function handleDeleteProject(target: Project) {
  await deleteProjectWithConfirm(target.id, target.name, target.overlayIds?.length ?? 0, () => {
    if (showInfoPopup.value) {
      overlayStore.hideInfoPopup();
    } else {
      closeProjectInfoPopup();
    }
  });
}

async function handleDrawShapesClick() {
  const currentProject = project.value;
  if (!currentProject) return;

  if (isMobile.value) {
    toast.add({ severity: "warn", summary: $t("shapes.desktopOnly"), life: 3000 });
    return;
  }

  // Capture geometry from the active overlay/project before closing the detail.
  const fallbackGeometry =
    overlay.value?.project?.geometry ?? projectInfoPopup.value.project?.geometry ?? null;

  uiStore.openShapeEditor(currentProject, true);
  if (showInfoPopup.value) overlayStore.hideInfoPopup();
  else closeProjectInfoPopup();
  await startShapeEditing(currentProject.id, fallbackGeometry);
}
</script>
