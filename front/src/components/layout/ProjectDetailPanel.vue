<template>
  <div class="project-detail-panel flex flex-col h-full min-h-0">
    <div v-if="!project" class="flex-1 flex justify-center items-center p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <template v-else>
      <div class="flex flex-col flex-auto min-h-0">
        <!-- Doubles as the drawer drag handle on mobile. -->
        <div class="drawer-drag-handle shrink-0 px-4" :class="isMobile ? 'pt-3 pb-2' : 'py-2.5'">
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
              <span
                class="text-base font-semibold leading-snug wrap-break-word"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{ displayName }}
              </span>
            </div>
            <div class="flex gap-1 shrink-0">
              <button
                v-if="canRecenter"
                type="button"
                :aria-label="$t('tooltips.centerProjectOnMap')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color bg-content-background border border-surface hover:text-primary-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--p-primary-color)_30%,transparent)]"
                @click="handleRecenter"
                v-tooltip.bottom="$t('tooltips.centerProjectOnMap')"
              >
                <i class="pi pi-map-marker"></i>
              </button>
              <!-- Edit: switch to edit mode and pin this project in the contribute panel, so the
                   user can act on it (add images, draw, edit fields) without closing the detail and
                   switching tabs by hand. -->
              <button
                type="button"
                :aria-label="$t('common.edit')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color bg-content-background border border-surface hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--p-primary-color)_30%,transparent)]"
                @click="handleEdit"
                v-tooltip.bottom="$t('tooltips.editThisProject')"
              >
                <i class="pi pi-pencil"></i>
              </button>
              <!-- Close: returns to the panel's tab content -->
              <button
                type="button"
                :aria-label="$t('common.close')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color bg-content-background border border-surface hover:text-color hover:bg-(--p-content-hover-background)"
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
            :class="[
              isMobile ? 'px-4 pt-3 pb-4' : 'px-4 pt-1 pb-3',
              scrollable
                ? 'h-full overflow-y-auto overscroll-contain scrollbar-none [&::-webkit-scrollbar]:hidden'
                : '',
            ]"
          >
            <div ref="contentRef">
              <ProjectMetadataCard
                :project="project"
                :wikidata-entity="wikidataEntity"
                :compact="!isMobile"
              />

              <div v-if="mapOverlays.length > 0" class="mt-2.5 pt-2.5 border-t border-surface">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-xs font-semibold text-muted-color">
                    {{ $t("project.mapImages") }}
                  </span>
                  <div
                    v-if="canScrollMapImagesBackward || canScrollMapImagesForward"
                    class="flex items-center gap-1"
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
                </div>
                <div
                  ref="mapImageScroll"
                  class="map-image-scroll flex gap-2 overflow-x-auto overscroll-x-contain"
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

              <!-- Project imagery below the metadata: the Wikidata main image (P18) and the
                   user-contributed render. Click to view full size. -->
              <div
                v-for="image in images"
                :key="image.url"
                class="mt-2.5 pt-2.5 border-t border-surface flex flex-col gap-1.5"
              >
                <span v-if="image.label" class="text-xs font-semibold text-muted-color">{{
                  image.label
                }}</span>
                <img
                  :src="image.url"
                  :crossorigin="image.crossorigin"
                  :referrerpolicy="image.referrerpolicy"
                  class="w-full rounded-lg object-cover cursor-zoom-in"
                  :class="isMobile ? 'max-h-48' : 'max-h-40'"
                  loading="lazy"
                  v-tooltip.top="$t('overlay.viewFullImage')"
                  @click="lightbox?.open(image)"
                />
              </div>

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
            style="--scroll-fade-color: var(--detail-panel-background, var(--p-content-background))"
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

withDefaults(
  defineProps<{
    scrollable?: boolean;
  }>(),
  { scrollable: true },
);

const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");
const mapImageScroll = useTemplateRef<HTMLElement>("mapImageScroll");
const canScrollMapImagesBackward = ref(false);
const canScrollMapImagesForward = ref(false);
let mapImageResizeObserver: ResizeObserver | null = null;

// Hide the scrollbar on the fields area and fade its bottom edge while there's more to scroll.
const { scrollAreaRef, contentRef, showScrollFade } = useScrollFade();

const uiStore = useUiStore();
const authStore = useAuthStore();
const { imageErrors: thumbnailErrors, handleImageError: handleThumbnailError } = useImageErrors();

const { project, overlay } = useDetailProject();

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

// When another project is picked while the panel stays open, the content swaps in place with no
// signal. Echo the open transition (short fade + slide-up) and scroll back to the top so the switch
// reads clearly as new content.
function replayContentRefresh() {
  const content = contentRef.value;
  if (scrollAreaRef.value) scrollAreaRef.value.scrollTop = 0;
  if (!content) return;
  content.classList.remove("detail-content-refresh");
  void content.offsetWidth;
  content.classList.add("detail-content-refresh");
  content.addEventListener(
    "animationend",
    () => content.classList.remove("detail-content-refresh"),
    { once: true },
  );
}

watch(
  () => project.value?.id,
  (id, previousId) => {
    if (id && previousId && id !== previousId) replayContentRefresh();
  },
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

// Back returns to the panel's tab list, closing whichever detail is open.
function handleBack() {
  closeDetail();
}
</script>

<style scoped>
.project-detail-panel {
  background: var(--detail-panel-background, var(--p-content-background));
}

/* Replayed when the panel stays open but switches to another project, signalling new content. */
.detail-content-refresh {
  animation: detail-content-refresh 0.28s ease-out;
}

.map-image-scroll {
  scrollbar-width: none;
}

.map-image-scroll::-webkit-scrollbar {
  display: none;
}

@keyframes detail-content-refresh {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .detail-content-refresh {
    animation-name: detail-content-refresh-fade;
  }

  @keyframes detail-content-refresh-fade {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
}
</style>
