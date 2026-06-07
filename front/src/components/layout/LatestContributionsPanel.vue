<template>
  <div class="relative h-full flex flex-col">
    <div
      ref="scrollAreaRef"
      class="flex-1 min-h-0 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
    >
      <div v-if="contributions.length > 0" ref="contentRef" class="flex flex-col">
        <template v-for="(contribution, index) in contributions" :key="contribution.id">
          <div
            v-if="contribution.isImport && index > 0 && !contributions[index - 1]?.isImport"
            class="flex items-center gap-2 px-3 pt-3 pb-1 select-none"
          >
            <span class="flex-1 border-t border-surface"></span>
            <span class="text-[11px] text-muted-color whitespace-nowrap">
              {{ t("contribution.fromOpenStreetMap") }}
            </span>
            <span class="flex-1 border-t border-surface"></span>
          </div>

          <div
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
        </template>
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

    <div v-if="isScrollable" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
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
import { useScrollFade } from "@/composables/ui/useScrollFade";
import {
  navigateToStandaloneProject,
  navigateToStandaloneProjectBounds,
  zoomToOverlayAndSelect,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { LngLat, LngLatBounds } from "maplibre-gl";

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
      mobileAwareFlyTo([contribution.centroid.lat, contribution.centroid.lng], 18);
    } else {
      console.warn("Contribution has no location data to fly to!", contribution);
    }
  } else if (contribution.type === "standalone") {
    if (contribution.geometryBbox) {
      // Fly to the actual geometry bounds instead of the project center point.
      const { minLat, maxLat, minLng, maxLng } = contribution.geometryBbox;
      const bounds = new LngLatBounds([minLng, minLat], [maxLng, maxLat]);
      // Anchor the popup on a point on the geometry itself, falling back to the bbox center.
      const popupLatLng = contribution.geometryPoint
        ? new LngLat(contribution.geometryPoint.lng, contribution.geometryPoint.lat)
        : new LngLat((minLng + maxLng) / 2, (minLat + maxLat) / 2);
      navigateToStandaloneProjectBounds(bounds, popupLatLng, contribution.id);
    } else if (typeof contribution.lat === "number" && typeof contribution.lng === "number") {
      navigateToStandaloneProject(contribution.lat, contribution.lng, contribution.id);
    }
  }
}

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { isScrollable } = useScrollFade(scrollAreaRef, contentRef);

onMounted(() => {
  fetchLatestContributions();
});
</script>
