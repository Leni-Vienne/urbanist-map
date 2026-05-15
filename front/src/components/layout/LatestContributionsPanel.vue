<template>
  <div class="h-full flex flex-col">
    <div
      ref="scrollAreaRef"
      :class="[
        'flex-1 min-h-0 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden',
        { 'scroll-area': isScrollable },
      ]"
    >
      <div v-if="contributions.length > 0" ref="contentRef" class="flex flex-col">
        <div
          v-for="contribution in contributions"
          :key="contribution.id"
          class="group flex items-center gap-3 px-2 py-2 cursor-pointer transition-all duration-150 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10 active:scale-[0.98]"
          @click="handleContributionClick(contribution)"
          @mouseenter="handleContributionHover(contribution)"
          @mouseleave="handleContributionLeave(contribution)"
        >
          <div
            class="w-13 h-13 md:w-15 md:h-15 rounded-xl overflow-hidden bg-content-hover-background border border-surface shrink-0 flex items-center justify-center relative"
          >
            <img
              v-if="contribution.type === 'overlay' && contribution.filename"
              :src="getContributionImageUrl(contribution.filename)"
              class="w-full h-full object-cover"
              alt=""
              :crossorigin="
                imageRequiresCredentials(getContributionImageUrl(contribution.filename))
                  ? 'use-credentials'
                  : undefined
              "
              @error="(event) => handleImageError(event, contribution.id)"
              @load="() => handleImageLoad(contribution.id)"
            />
            <i
              v-else-if="contribution.type === 'standalone'"
              class="pi pi-building text-2xl text-primary-color"
            ></i>
            <i
              v-else-if="imageErrors[contribution.id]"
              class="pi pi-image text-2xl text-muted-color"
            ></i>
          </div>

          <!-- Contribution info -->
          <div class="flex-1 min-w-0">
            <h2
              class="text-[13px] md:text-sm font-semibold truncate leading-tight mb-0.5"
              :class="contribution.name ? 'text-color' : 'text-muted-color italic'"
            >
              {{
                contribution.name ||
                (contribution.type === "overlay" ? $t("overlay.untitled") : $t("project.unnamed"))
              }}
            </h2>
            <div class="text-xs text-muted-color truncate mb-0.5">
              {{ getLocationDisplay(contribution) }}
            </div>
            <div class="text-xs text-muted-color">
              {{ formatRelativeTime(contribution.updatedAt, t) }}
            </div>
          </div>

          <i
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150 group-hover:text-(--p-text-color-secondary)"
          ></i>
        </div>
      </div>

      <div
        v-else-if="!isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-(--p-text-color-secondary)"
      >
        <i class="pi pi-image text-5xl text-muted-color mb-4"></i>
        <p class="text-base mb-2">
          {{ t("contribution.noContributionsFound") }}
        </p>
        <p class="text-sm">{{ t("contribution.beFirstToAdd") }}</p>
      </div>

      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-(--p-text-color-secondary)"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ t("contribution.loadingContributions") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onActivated, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  canModerateCountry,
  syncModerationCountry,
} from "@/composables/overlay/useOverlayClickHandler";
import { useLatestContributions } from "@/composables/overlay/useLatestContributions";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useToast } from "@/composables/ui/useToast";
import {
  navigateToStandaloneProject,
  zoomToOverlayAndSelect,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/overlaySelection";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { requestScrollTo } from "@/services/layout/accordionState";
import { map } from "@/services/core/map";
import L from "leaflet";

const { t } = useI18n();
const mapStore = useMapStore();
const toast = useToast();

const { contributions, isLoading, fetchLatestContributions } = useLatestContributions();
const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();

function getContributionImageUrl(filename: string): string {
  return buildThumbnailUrl(filename);
}

function getLocationDisplay(contribution: LatestContribution): string {
  if (contribution.cityName && contribution.countryName) {
    return `${contribution.cityName}, ${contribution.countryName}`;
  } else if (contribution.cityName) {
    return contribution.cityName;
  } else if (contribution.countryName && contribution.countryCode) {
    return `${contribution.countryName} (${contribution.countryCode})`;
  } else if (contribution.countryCode) {
    return contribution.countryCode;
  } else if (contribution.countryName) {
    return contribution.countryName;
  }
  return t("project.noLocation");
}

function handleContributionHover(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    highlightOverlayById(contribution.id);
  }
}

function handleContributionLeave(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    removeOverlayHighlight(contribution.id);
  }
}

async function handleContributionClick(contribution: LatestContribution) {
  // In moderation mode, auto-select the country for the moderation panel
  // Block navigation if the moderator can't moderate this country
  if (mapStore.mode === "moderation" && contribution.countryCode) {
    if (!canModerateCountry(contribution.countryCode)) {
      toast.add({
        severity: "warn",
        summary: t("moderation.title"),
        detail: t("moderation.noAccessToThisCountry"),
        life: 4000,
      });
      return;
    }
    syncModerationCountry(contribution.countryCode);
  }

  if (contribution.type === "overlay") {
    if (contribution.corners && contribution.corners.length === 4) {
      zoomToOverlayAndSelect(contribution.id, contribution.corners);
    } else if (contribution.centroid) {
      mobileAwareFlyTo([contribution.centroid.lat, contribution.centroid.lng], 18, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  } else if (contribution.type === "standalone") {
    if (contribution.geometryBbox) {
      // Fly to the actual geometry bounds instead of the project center point
      const { minLat, maxLat, minLng, maxLng } = contribution.geometryBbox;
      const bounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50],
        maxZoom: 18,
        duration: 1.5,
        easeLinearity: 0.25,
      });
      requestScrollTo("project", contribution.id);
      // Use a point on the geometry itself so the popup anchors on the actual vector
      const popupLatLng = contribution.geometryPoint
        ? L.latLng(contribution.geometryPoint.lat, contribution.geometryPoint.lng)
        : L.latLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
      map.value.once("moveend", () => {
        void handleProjectClickFromTile(contribution.id, popupLatLng);
      });
    } else if (contribution.lat && contribution.lng) {
      await navigateToStandaloneProject(contribution.lat, contribution.lng, contribution.id);
    }
  }
}

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const isScrollable = ref(false);

function updateScrollable() {
  const el = scrollAreaRef.value;
  if (el) isScrollable.value = el.scrollHeight > el.clientHeight;
}

const scrollObserver = new ResizeObserver(updateScrollable);

onMounted(() => {
  if (scrollAreaRef.value) scrollObserver.observe(scrollAreaRef.value);
  fetchLatestContributions();
  updateScrollable();
});

onActivated(updateScrollable);

onBeforeUnmount(() => scrollObserver.disconnect());

watch(contentRef, (el, oldEl) => {
  if (oldEl) scrollObserver.unobserve(oldEl);
  if (el) {
    scrollObserver.observe(el);
    updateScrollable();
  } else {
    isScrollable.value = false;
  }
});
</script>

<style scoped>
.scroll-area {
  mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
}
</style>
