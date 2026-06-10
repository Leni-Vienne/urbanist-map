<template>
  <div class="flex flex-col h-full min-h-0 bg-content-background">
    <div v-if="!project" class="flex-1 flex justify-center items-center p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <template v-else>
      <!-- Recenter region: the project header and the info area below share one click target, so
           clicking anywhere (except the close button, links and images, which stop propagation)
           recenters the map on the project. The chevron on the right marks the region as clickable. -->
      <div
        class="flex flex-col flex-1 min-h-0 transition-colors duration-150"
        :class="{ 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 group': canRecenter }"
        @click="handleRecenter"
      >
        <!-- Project header: project name + close button -->
        <div class="px-4 pt-3 pb-2 shrink-0">
          <div class="flex gap-2 items-center">
            <!-- Left: project name (recenters via the surrounding region) -->
            <div class="flex-1 flex items-center gap-1.5 min-w-0">
              <!-- Wikidata logo (e.g. metro line badge) shown when available -->
              <img
                v-if="wikidataEntity?.logoUrl"
                :src="wikidataEntity.logoUrl"
                class="w-5 h-5 object-contain shrink-0"
                referrerpolicy="no-referrer"
                loading="eager"
              />
              <span
                class="text-sm font-semibold leading-snug wrap-break-word transition-colors group-hover:text-primary-color"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{
                  project?.name ||
                  (project?.importSource?.type === "osm"
                    ? $t("project.osmName")
                    : $t("project.unnamed"))
                }}
              </span>
            </div>
            <!-- Right: close button (stops propagation so it doesn't recenter) -->
            <div class="flex gap-1 shrink-0" @click.stop>
              <!-- Close: returns to the panel's tab content -->
              <button
                type="button"
                :aria-label="$t('common.close')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color hover:text-color hover:bg-content-hover-background bg-transparent border-none"
                @click="handleBack"
                v-tooltip.top="$t('common.close')"
              >
                <i class="pi pi-times"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Project fields + overlay section (links and images inside stop propagation so they
             keep their own click behavior instead of recentering). -->
        <div class="px-4 pb-4 flex-1 overflow-y-auto overscroll-contain">
          <div class="flex flex-row items-start gap-3">
            <div class="flex-1 min-w-0">
              <ProjectMetadataCard :project="project" :show-name="false" :show-description="true" />

              <!-- Wikidata main image (P18) shown at the bottom of the metadata section. Click to zoom. -->
              <div v-if="wikidataEntity?.imageUrl" class="mt-3 pt-3 border-t border-surface">
                <img
                  :src="wikidataEntity.imageUrl"
                  class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
                  referrerpolicy="no-referrer"
                  loading="lazy"
                  v-tooltip.top="$t('overlay.viewFullImage')"
                  @click.stop="
                    lightbox.open({
                      url: wikidataEntity.imageUrl,
                      header:
                        project?.name ||
                        (project?.importSource?.type === 'osm'
                          ? $t('project.osmName')
                          : $t('project.unnamed')),
                      referrerpolicy: 'no-referrer',
                    })
                  "
                />
              </div>

              <!-- Render (artist's impression): a user-contributed, non-georeferenced project image.
             Added/replaced via the project edit form, not here. Click to view full size. -->
              <div
                v-if="renderImageUrl"
                class="mt-3 pt-3 border-t border-surface flex flex-col gap-1.5"
              >
                <span class="text-xs font-semibold text-muted-color">{{ $t("render.label") }}</span>
                <img
                  :src="renderImageUrl"
                  :crossorigin="renderImageCrossorigin"
                  class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
                  loading="lazy"
                  v-tooltip.top="$t('overlay.viewFullImage')"
                  @click.stop="
                    lightbox.open({
                      url: renderImageUrl,
                      header: $t('render.label'),
                      crossorigin: renderImageCrossorigin,
                    })
                  "
                />
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
          </div>
        </div>
      </div>
    </template>

    <!-- Full-size image lightbox: scroll to zoom (toward cursor), drag to pan, double-click to reset -->
    <Dialog
      v-model:visible="lightbox.visible"
      modal
      dismissableMask
      :draggable="false"
      :header="lightbox.image?.header"
      :style="{ width: 'auto', maxWidth: '90vw' }"
      :pt="{ content: { class: 'p-0' } }"
    >
      <div
        class="overflow-hidden max-h-[80vh] max-w-[90vw] flex items-center justify-center touch-none"
        @wheel.prevent="lightbox.handleWheel"
        @pointerdown="lightbox.handlePointerDown"
        @pointermove="lightbox.handlePointerMove"
        @pointerup="lightbox.handlePointerUp"
        @pointerleave="lightbox.handlePointerUp"
        @dblclick="lightbox.reset"
      >
        <img
          v-if="lightbox.image"
          ref="lightboxImg"
          :src="lightbox.image.url"
          :crossorigin="lightbox.image.crossorigin"
          :referrerpolicy="lightbox.image.referrerpolicy"
          class="block max-h-[80vh] max-w-[90vw] object-contain select-none"
          :class="
            lightbox.zoom > 1
              ? lightbox.isPanning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-zoom-in'
          "
          :style="{
            transform: `translate(${lightbox.pan.x}px, ${lightbox.pan.y}px) scale(${lightbox.zoom})`,
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
import { useImageLightbox } from "@/composables/ui/useImageLightbox";

import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";

import { navigateToOverlay } from "@/services/overlay/actions";
import { flyToGeometry, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { computeShapeBounds } from "@/services/map/shapeRendering";
import { closeProjectDetailAndResetMarkers } from "@/services/map/standaloneProjectMarkers";

import { buildImageUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { createProjectObject } from "@/utils/typeFactories";
import { trpc } from "@/client";
import type { OverlayData, Project } from "@/types/index";

import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t: $t, t } = useI18n();
const toast = useToast();
const lightbox = useImageLightbox();

const projectStore = useProjectStore();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const { overlays, overlayDetailVisible, overlayDetailId } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { projectDetail } = storeToRefs(uiStore);

const overlay = computed(() => {
  if (
    !overlayDetailVisible.value ||
    !overlayDetailId.value ||
    !overlays.value[overlayDetailId.value]
  ) {
    return null;
  }
  return overlays.value[overlayDetailId.value];
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

// The detail panel is view-only, so show the original approved data for locally-modified projects.
function getEffectiveProject(projectId: string): Project | undefined {
  const localProject = projects.value[projectId];
  if (!localProject) return undefined;
  if (localProject.isModified) {
    const original = projectStore.getOriginalProject(projectId);
    if (original) return original as Project;
  }
  return localProject;
}

const project = computed<Project | undefined>(() => {
  // Check overlay detail first.
  const currentOverlay = overlay.value;
  if (currentOverlay?.projectId) {
    const localProject = getEffectiveProject(currentOverlay.projectId);
    if (localProject) return localProject;

    const backendProject =
      currentOverlay.project?.id === currentOverlay.projectId ? currentOverlay.project : null;
    if (backendProject) return convertAndCacheBackendProject(backendProject);
  }

  // Fall back to project detail.
  if (projectDetail.value.visible && projectDetail.value.projectId) {
    const localProject = getEffectiveProject(projectDetail.value.projectId);
    if (localProject) return localProject;

    if (projectDetail.value.project) return projectDetail.value.project;
  }

  return undefined;
});

// Project render (artist's impression), delivered with the project by project.getById. The backend
// already scopes this to approved or the user's own pending render.
const renderImage = computed(() => project.value?.render ?? null);

// Marker-opened details load their project via getById (render included), but overlay-opened details build it from
// the viewport payload, which omits render (undefined). Hydrate that one case via getById.
watch(
  () => project.value?.id,
  async (id) => {
    const current = project.value;
    if (!id || !current || current.status === null || current.render !== undefined) return;
    try {
      const fresh = await trpc.project.getById.query({ id });
      if (fresh)
        projectStore.updateProject(id, {
          render: fresh.render ?? null,
          ownerUsername: fresh.ownerUsername ?? null,
        });
    } catch (error) {
      console.error("Failed to hydrate project render:", error);
    }
  },
  { immediate: true },
);

const renderImageUrl = computed(() => {
  const render = renderImage.value;
  if (!render || render.status !== "approved") return null;
  return buildImageUrl(render.filename, false);
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

// Recenter is only possible when the project carries a map location.
const canRecenter = computed(
  () => typeof project.value?.lat === "number" && typeof project.value?.lng === "number",
);

// Frame the project on the map. With line/polygon geometry, fit its exact bounds so the whole shape
// shows, zooming out when the camera sits tighter than the geometry needs. Point-only standalone
// projects fall back to a centroid fly.
function handleRecenter() {
  const target = project.value;
  if (!target || typeof target.lat !== "number" || typeof target.lng !== "number") return;
  const geometries = target.geometry?.geometries;
  if (geometries?.length) {
    const bounds = computeShapeBounds(geometries);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, { maxZoom: 17 });
      return;
    }
  }
  flyToGeometry([target.lat, target.lng], target.geometrySizeM ?? 0);
}

function closeProjectDetail() {
  uiStore.closeProjectDetail();
  closeProjectDetailAndResetMarkers();
}

// Back returns to the panel's tab list, closing whichever detail is open.
function handleBack() {
  if (overlayDetailVisible.value) {
    overlayStore.closeOverlayDetail();
  } else {
    closeProjectDetail();
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
</script>
