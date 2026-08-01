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
        class="flex flex-col flex-auto min-h-0 transition-colors duration-150"
        :class="{ 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/10': canRecenter }"
        @click="handleRecenter"
      >
        <!-- Project header. On desktop it's a neutral block that anchors the panel; on mobile it's
             plain (the drawer frames it). Doubles as the drawer drag handle on mobile. -->
        <div
          class="drawer-drag-handle shrink-0"
          :class="
            showHeaderBand
              ? 'px-4 py-3 bg-content-hover-background border-b border-surface'
              : 'px-4 pt-3 pb-2'
          "
        >
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
                class="text-sm font-semibold leading-snug wrap-break-word"
                :class="project?.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{ displayName }}
              </span>
            </div>
            <!-- Right: edit + close buttons (stop propagation so they don't recenter) -->
            <div class="flex gap-1 shrink-0" @click.stop>
              <!-- Edit: switch to edit mode and pin this project in the contribute panel, so the
                   user can act on it (add images, draw, edit fields) without closing the detail and
                   switching tabs by hand. Only in view mode (moderation keeps its own context). -->
              <button
                v-if="canEdit"
                type="button"
                :aria-label="$t('common.edit')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] bg-transparent border-none"
                @click="handleEdit"
                v-tooltip.bottom="$t('tooltips.editThisProject')"
              >
                <i class="pi pi-pencil"></i>
              </button>
              <!-- Close: returns to the panel's tab content -->
              <button
                type="button"
                :aria-label="$t('common.close')"
                class="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color hover:text-color hover:bg-black/5 dark:hover:bg-white/10 bg-transparent border-none"
                @click="handleBack"
              >
                <i class="pi pi-times"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Project fields + overlay section (links and images inside stop propagation so they
             keep their own click behavior instead of recentering). Sizes to its content when the
             host leaves the panel's height open, and scrolls in place when the host fixes it. -->
        <div class="relative flex-auto min-h-0">
          <div
            ref="scrollAreaRef"
            class="h-full px-4 pt-3 pb-4 overflow-y-auto overscroll-contain scrollbar-none [&::-webkit-scrollbar]:hidden"
          >
            <div ref="contentRef">
              <ProjectMetadataCard :project="project" />

              <!-- Project imagery below the metadata: the Wikidata main image (P18) and the
                   user-contributed render. Click to view full size. -->
              <div
                v-for="image in images"
                :key="image.url"
                class="mt-3 pt-3 border-t border-surface flex flex-col gap-1.5"
              >
                <span v-if="image.label" class="text-xs font-semibold text-muted-color">{{
                  image.label
                }}</span>
                <img
                  :src="image.url"
                  :crossorigin="image.crossorigin"
                  :referrerpolicy="image.referrerpolicy"
                  class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
                  loading="lazy"
                  v-tooltip.top="$t('overlay.viewFullImage')"
                  @click.stop="lightbox?.open(image)"
                />
              </div>

              <!-- Show view original button for pending replacements -->
              <div
                v-if="overlay?.replacesOverlayId && overlay?.status === 'pending'"
                class="mt-3 pt-3 border-t border-surface"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-2 font-medium text-sm text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-400/12 border border-purple-200 dark:border-purple-400/40 rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-purple-100 dark:hover:bg-purple-400/20 hover:border-purple-300 dark:hover:border-purple-400/60 hover:text-purple-700 dark:hover:text-purple-200"
                  @click.stop="handleViewOriginalOverlay(overlay.replacesOverlayId)"
                >
                  <i class="pi pi-arrow-left text-sm"></i>
                  {{ $t("overlay.viewOriginalOverlay") }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="showScrollFade" class="detail-scroll-fade"></div>
        </div>
      </div>
    </template>

    <ImageLightbox ref="lightbox" />
  </div>
</template>

<script setup lang="ts">
import { toastError } from "@/services/core/toast";

import { computed, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useDetailProject } from "@/composables/project/useDetailProject";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import { useScrollFade } from "@/composables/ui/useScrollFade";
import { isMobile } from "@/services/core/viewport";

import { useUiStore } from "@/stores/uiStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";

import { navigateToOverlay } from "@/services/overlay/navigation";
import { flyToGeometry, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { computeShapeBounds } from "@/services/map/shapes/rendering";
import { openProjectForEditing } from "@/services/core/projectSelection";
import { closeDetail } from "@/services/overlay/selection";

import { buildImageUrl, imageRequiresCredentials } from "@/utils/imageUrl";

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

const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");

// Hide the scrollbar on the fields area and fade its bottom edge while there's more to scroll.
const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

const uiStore = useUiStore();
const mapStore = useMapStore();
const authStore = useAuthStore();

const { project, overlay } = useDetailProject();

// Wikidata entity for the current project (logo, description, height)
const { entity: wikidataEntity } = useWikidataEntity(
  computed(() => project.value?.externalProperties),
);

const displayName = computed(() => {
  const current = project.value;
  if (current?.name) return current.name;
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

// A neutral header block anchors the panel on desktop; on mobile the drawer already frames it.
const showHeaderBand = computed(() => !isMobile.value);

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

// The edit affordance only makes sense in view mode: moderation keeps its own selection context,
// and edit mode shows the contribute panel where these actions already live.
const canEdit = computed(() => mapStore.mode === "view" && project.value !== undefined);

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

async function handleViewOriginalOverlay(originalOverlayId: string) {
  try {
    const success = await navigateToOverlay(originalOverlayId);
    if (!success) {
      toastError(t("overlay.failedToNavigate"), t("overlay.navigationFailed"));
    }
  } catch (error) {
    console.error("Failed to navigate to original overlay:", error);
    toastError(
      error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      t("overlay.navigationFailed"),
    );
  }
}
</script>

<style scoped>
/* Bottom fade over the fields scroll area, matching the panel background, shown only when scrollable. */
.detail-scroll-fade {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 3rem;
  pointer-events: none;
  background: linear-gradient(to top, var(--p-content-background), transparent);
}

/* Replayed when the panel stays open but switches to another project, signalling new content. */
.detail-content-refresh {
  animation: detail-content-refresh 0.28s ease-out;
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
