<template>
  <div class="project-detail-panel flex flex-col h-full min-h-0">
    <div v-if="!project || loadStatus === 'unavailable'" class="flex min-h-0 flex-1 flex-col">
      <div
        class="drawer-drag-handle flex shrink-0 items-center gap-2 pl-4 pr-2"
        :class="isMobile ? 'pt-3 pb-2' : 'py-2.5'"
      >
        <div
          v-if="loadStatus === 'loading'"
          class="h-4 w-2/3 rounded bg-(--p-content-hover-background)"
          aria-hidden="true"
        ></div>
        <span v-else class="font-semibold">{{ $t("project.detailsTitle") }}</span>
        <button
          type="button"
          ref="closeButton"
          :aria-label="$t('common.close')"
          class="ml-auto w-8 h-8 shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-colors duration-150 text-sm text-muted-color bg-transparent border-0 hover:text-color hover:bg-(--p-content-hover-background)"
          @click="handleBack"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>
      <div
        v-if="loadStatus === 'loading'"
        role="status"
        class="min-h-0 overflow-hidden px-4 pt-1 pb-3"
      >
        <span class="sr-only">{{ $t("common.loading") }}</span>
        <div class="flex flex-col gap-3" aria-hidden="true">
          <div class="h-3 w-3/4 rounded bg-(--p-content-hover-background)"></div>
          <div class="h-3 w-full rounded bg-(--p-content-hover-background)"></div>
          <div class="h-3 w-1/2 rounded bg-(--p-content-hover-background)"></div>
          <div class="h-32 w-full rounded-lg bg-(--p-content-hover-background)"></div>
        </div>
      </div>
      <div v-else role="status" class="min-h-0 overflow-y-auto px-4 pb-4 text-sm">
        <p>{{ $t(loadStatus === "error" ? "project.loadError" : "project.unavailable") }}</p>
        <Button
          v-if="loadStatus === 'error'"
          :label="$t('common.retry')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          @click="handleRetry"
        />
      </div>
    </div>
    <template v-else>
      <div class="flex flex-col flex-auto min-h-0">
        <!-- Doubles as the drawer drag handle on mobile. -->
        <div
          class="drawer-drag-handle shrink-0 pl-4 pr-2"
          :class="isMobile ? 'pt-3 pb-2' : 'py-2.5'"
        >
          <div class="flex gap-2 items-center">
            <div class="flex-1 flex items-center gap-1.5 min-w-0">
              <!-- Wikidata logo (e.g. metro line badge) shown when available -->
              <img
                v-if="wikidataEntity?.logoUrl"
                :src="wikidataEntity.logoUrl"
                class="w-5 h-5 object-contain shrink-0"
                referrerpolicy="no-referrer"
                loading="eager"
              />
              <button
                v-if="canRecenter"
                type="button"
                :aria-label="$t('project.centerOnMap')"
                class="min-w-0 p-0 text-left text-base font-semibold leading-snug wrap-break-word bg-transparent border-0 cursor-pointer underline-offset-2 hover:text-primary-color hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-color"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
                @click="handleRecenter"
              >
                {{ displayName }}
              </button>
              <span
                v-else
                class="text-base font-semibold leading-snug wrap-break-word"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{ displayName }}
              </span>
            </div>
            <div class="flex gap-1 shrink-0">
              <!-- Edit: switch to edit mode and pin this project in the contribute panel, so the
                   user can act on it (add images, draw, edit fields) without closing the detail and
                   switching tabs by hand. -->
              <button
                type="button"
                :aria-label="$t('common.edit')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors duration-150 text-sm text-primary-color bg-transparent border-0 hover:text-primary-hover-color hover:bg-(--p-content-hover-background)"
                @click="handleEdit"
              >
                <i class="pi pi-pencil"></i>
              </button>
              <!-- Close: returns to the panel's tab content -->
              <button
                type="button"
                ref="closeButton"
                :aria-label="$t('common.close')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors duration-150 text-sm text-muted-color bg-transparent border-0 hover:text-color hover:bg-(--p-content-hover-background)"
                @click="handleBack"
              >
                <i class="pi pi-times"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="relative flex-auto min-h-0">
          <div
            ref="scrollAreaRef"
            class="detail-scroll-area h-full overflow-y-auto overscroll-contain"
            :class="isMobile ? 'px-4 pt-3 pb-4' : 'px-4 pt-1 pb-3'"
          >
            <div ref="contentRef">
              <div
                v-if="loadStatus === 'error'"
                role="status"
                class="mb-3 flex flex-col items-start gap-2 text-sm"
              >
                <p>{{ $t("project.loadError") }}</p>
                <Button
                  :label="$t('common.retry')"
                  icon="pi pi-refresh"
                  size="small"
                  severity="secondary"
                  @click="handleRetry"
                />
              </div>
              <ProjectMetadataCard
                :project="project"
                :wikidata-entity="wikidataEntity"
                :compact="!isMobile"
              />

              <div v-if="mapOverlays.length > 0" class="mt-2.5 pt-2.5 border-t border-surface">
                <div class="flex items-center gap-2">
                  <div
                    v-if="canScrollMapImagesBackward || canScrollMapImagesForward"
                    class="order-2 flex items-center gap-1"
                  >
                    <button
                      type="button"
                      class="w-6 h-6 rounded-md flex items-center justify-center border border-surface bg-content-background text-muted-color cursor-pointer hover:text-color hover:bg-(--p-content-hover-background) disabled:opacity-30 disabled:cursor-default"
                      :aria-label="$t('project.previousMapImages')"
                      :disabled="!canScrollMapImagesBackward"
                      @click="scrollMapImages(-1)"
                    >
                      <i class="pi pi-chevron-left text-[10px]"></i>
                    </button>
                    <button
                      type="button"
                      class="w-6 h-6 rounded-md flex items-center justify-center border border-surface bg-content-background text-muted-color cursor-pointer hover:text-color hover:bg-(--p-content-hover-background) disabled:opacity-30 disabled:cursor-default"
                      :aria-label="$t('project.nextMapImages')"
                      :disabled="!canScrollMapImagesForward"
                      @click="scrollMapImages(1)"
                    >
                      <i class="pi pi-chevron-right text-[10px]"></i>
                    </button>
                  </div>
                  <div
                    ref="mapImageScroll"
                    class="map-image-scroll order-1 min-w-0 flex-1 flex gap-2 overflow-x-auto overscroll-x-contain"
                    role="group"
                    :aria-label="$t('project.mapImages')"
                    @scroll="updateMapImageScroll"
                  >
                    <button
                      v-for="mapOverlay in mapOverlays"
                      :key="mapOverlay.id"
                      type="button"
                      class="w-16 h-16 p-0 shrink-0 overflow-hidden rounded-lg border-2 bg-(--p-content-hover-background) cursor-pointer transition-all duration-150 hover:border-primary-color active:scale-95 flex items-center justify-center"
                      :class="
                        mapOverlay.id === overlay?.id ? 'border-primary-color' : 'border-surface'
                      "
                      :aria-label="mapOverlay.caption || $t('overlay.untitled')"
                      :aria-current="mapOverlay.id === overlay?.id ? 'true' : undefined"
                      @click="handleMapOverlayClick(mapOverlay)"
                    >
                      <img
                        v-if="!thumbnailErrors[mapOverlay.id]"
                        :src="buildThumbnailUrl(mapOverlay.filename)"
                        :alt="mapOverlay.caption ?? undefined"
                        class="w-full h-full object-cover"
                        loading="lazy"
                        :crossorigin="
                          imageRequiresCredentials(buildThumbnailUrl(mapOverlay.filename))
                            ? 'use-credentials'
                            : undefined
                        "
                        @error="handleThumbnailError(mapOverlay.id)"
                      />
                      <i v-else class="pi pi-image text-xl text-muted-color"></i>
                    </button>
                  </div>
                </div>
              </div>

              <figure
                v-for="image in images"
                :key="image.url"
                class="m-0 mt-2.5 pt-2.5 border-t border-surface flex flex-col gap-1.5"
              >
                <button
                  type="button"
                  class="group relative block w-full p-0 overflow-hidden rounded-lg border-0 bg-transparent cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-color"
                  :aria-label="$t('overlay.viewFullImage')"
                  @click="lightbox?.open(image)"
                >
                  <img
                    :src="image.url"
                    :crossorigin="image.crossorigin"
                    :referrerpolicy="image.referrerpolicy"
                    class="block w-full object-cover"
                    :class="isMobile ? 'max-h-48' : 'max-h-40'"
                    loading="lazy"
                  />
                  <span
                    class="absolute right-2 bottom-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center shadow-sm transition-colors duration-150 group-hover:bg-black/75"
                    aria-hidden="true"
                  >
                    <i class="pi pi-search-plus text-xs"></i>
                  </span>
                </button>
                <figcaption v-if="image.label" class="text-xs text-muted-color">
                  {{ image.label }}
                </figcaption>
              </figure>

              <!-- Show view original button for pending replacements -->
              <div
                v-if="overlay?.replacesOverlayId && overlay?.status === 'pending'"
                class="mt-2.5 pt-2.5 border-t border-surface"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-2 font-medium text-sm text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-400/12 border border-purple-200 dark:border-purple-400/40 rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-purple-100 dark:hover:bg-purple-400/20 hover:border-purple-300 dark:hover:border-purple-400/60 hover:text-purple-700 dark:hover:text-purple-200"
                  @click="viewOriginalOverlay(overlay.replacesOverlayId)"
                >
                  <i class="pi pi-arrow-left text-sm"></i>
                  {{ $t("overlay.viewOriginalOverlay") }}
                </button>
              </div>
            </div>
          </div>
          <!-- The fade matches the panel background, not the hover background the class defaults to. -->
          <div
            v-if="showScrollFade"
            class="scroll-fade-overlay"
            style="--scroll-fade-color: var(--p-content-background)"
          ></div>
        </div>
      </div>
    </template>

    <ImageLightbox ref="lightbox" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useDetailProject } from "@/composables/project/useDetailProject";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import { useScrollFade } from "@/composables/ui/useScrollFade";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { isMobile } from "@/services/core/viewport";

import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";
import { useAuthStore } from "@/stores/authStore";

import { navigateToOverlay, viewOriginalOverlay } from "@/services/overlay/navigation";
import { flyToGeometry, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { openProjectForEditing } from "@/services/core/projectSelection";
import { closeDetail } from "@/services/overlay/selection";

import { buildImageUrl, buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { formatConstructionName } from "@shared/osmRules";
import type { ProjectMapOverlay } from "@/types/index";

import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";
import ImageLightbox from "@/components/common/ImageLightbox.vue";

// A full-size-viewable image, shaped so it can be handed straight to the lightbox.
interface DetailImage {
  url: string;
  header: string;
  label?: string;
  crossorigin?: "use-credentials";
  referrerpolicy?: "no-referrer";
}

const { t } = useI18n();

const closeButton = useTemplateRef<HTMLButtonElement>("closeButton");

const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");
const mapImageScroll = useTemplateRef<HTMLElement>("mapImageScroll");
const canScrollMapImagesBackward = ref(false);
const canScrollMapImagesForward = ref(false);
let mapImageResizeObserver: ResizeObserver | null = null;

// Fade the bottom edge while there is more content to scroll.
const scrollAreaRef = useTemplateRef<HTMLElement>("scrollAreaRef");
const contentRef = useTemplateRef<HTMLElement>("contentRef");
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

const uiStore = useUiStore();
const focusStore = useFocusStore();
const authStore = useAuthStore();
const { imageErrors: thumbnailErrors, handleImageError: handleThumbnailError } = useImageErrors();

const { project, overlay, loadStatus, retry } = useDetailProject();

const mapOverlays = computed(() => project.value?.mapOverlays ?? []);

function updateMapImageScroll(): void {
  const element = mapImageScroll.value;
  if (!element) {
    canScrollMapImagesBackward.value = false;
    canScrollMapImagesForward.value = false;
    return;
  }

  canScrollMapImagesBackward.value = element.scrollLeft > 1;
  canScrollMapImagesForward.value =
    element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
}

function observeMapImageScroll(element: HTMLElement | null): void {
  mapImageResizeObserver?.disconnect();
  if (!element) return;
  mapImageResizeObserver ??= new ResizeObserver(updateMapImageScroll);
  mapImageResizeObserver.observe(element);
  updateMapImageScroll();
}

function refreshMapImageScroll(): void {
  void nextTick().then(updateMapImageScroll);
}

function scrollMapImages(direction: -1 | 1): void {
  const element = mapImageScroll.value;
  if (!element) return;
  element.scrollBy({
    left: direction * Math.max(element.clientWidth - 64, 64),
    behavior: "smooth",
  });
}

function disconnectMapImageResizeObserver(): void {
  mapImageResizeObserver?.disconnect();
}

watch(mapImageScroll, observeMapImageScroll, { flush: "post" });
watch(mapOverlays, refreshMapImageScroll, { flush: "post" });
onBeforeUnmount(disconnectMapImageResizeObserver);

// Wikidata entity for the current project (logo, image)
const { entity: wikidataEntity } = useWikidataEntity(
  computed(() => project.value?.externalProperties ?? null),
);

const displayName = computed(() => {
  const current = project.value;
  if (current?.name) return current.name;
  const constructionName = formatConstructionName(current?.externalProperties?.construction);
  if (constructionName) return constructionName;
  return current?.importSource?.type === "osm" ? t("project.osmName") : t("project.unnamed");
});

// Project render (artist's impression), delivered with the project by project.getById. The backend
// already scopes this to approved or the user's own pending render.
const renderImageUrl = computed(() => {
  const render = project.value?.render;
  if (!render || render.status !== "approved") return null;
  return buildImageUrl(render.filename, false);
});

const images = computed<DetailImage[]>(() => {
  const list: DetailImage[] = [];

  const wikidataUrl = wikidataEntity.value?.imageUrl;
  if (wikidataUrl) {
    list.push({ url: wikidataUrl, header: displayName.value, referrerpolicy: "no-referrer" });
  }

  const renderUrl = renderImageUrl.value;
  if (renderUrl) {
    list.push({
      url: renderUrl,
      header: t("render.label"),
      label: t("render.label"),
      crossorigin: imageRequiresCredentials(renderUrl) ? "use-credentials" : undefined,
    });
  }

  return list;
});

async function handleMapOverlayClick(mapOverlay: ProjectMapOverlay): Promise<void> {
  await navigateToOverlay(mapOverlay.id);
}

// Follow the selection rather than the resolved project: uncached projects temporarily resolve
// to undefined. A post-render reset also covers the scroll area appearing after data arrives.
function resetDetailScroll(): void {
  scrollAreaRef.value?.scrollTo({ top: 0 });
}

watch(
  [() => focusStore.selectedProjectId, () => focusStore.selectedOverlayId, scrollAreaRef],
  resetDetailScroll,
  { flush: "post" },
);

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
  if (target.geometry?.geometries.length) {
    const bounds = buildShapeBounds(target.geometry);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, { maxZoom: 17 });
      return;
    }
  }
  flyToGeometry([target.lat, target.lng], target.geometrySizeM ?? 0);
}

// Carry the current project into edit mode so the contribute panel surfaces its actions right away.
function handleEdit() {
  const target = project.value;
  if (!target) return;

  if (!authStore.isAuthenticated) {
    uiStore.openAuthModal();
    return;
  }

  openProjectForEditing(target);
}

async function handleRetry(): Promise<void> {
  const projectId = focusStore.selectedProjectId;
  const restoreFocus = document.activeElement?.closest(".project-detail-panel") !== null;
  await retry();
  await nextTick();
  if (
    restoreFocus &&
    focusStore.selectedProjectId === projectId &&
    document.activeElement === document.body
  ) {
    closeButton.value?.focus();
  }
}

// Back returns to the panel's tab list, closing whichever detail is open.
function handleBack() {
  closeDetail();
}
</script>

<style scoped>
.project-detail-panel {
  background: var(--p-content-background);
}

.detail-scroll-area {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--p-text-muted-color) 35%, transparent) transparent;
}

.map-image-scroll {
  scrollbar-width: none;
}

.map-image-scroll::-webkit-scrollbar {
  display: none;
}
</style>
