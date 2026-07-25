<template>
  <div class="relative h-full flex flex-col">
    <div
      ref="scrollAreaRef"
      class="flex-1 min-h-0 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
    >
      <div v-if="rows.length > 0" ref="contentRef" class="flex flex-col">
        <template v-for="(row, index) in rows" :key="row.contribution.id">
          <div
            v-if="row.contribution.isImport && index > 0 && !rows[index - 1]?.contribution.isImport"
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
            @click="handleContributionClick(row.contribution)"
            @mouseenter="handleContributionHover(row.contribution)"
            @mouseleave="handleContributionLeave(row.contribution)"
          >
            <div
              class="w-13 h-13 md:w-15 md:h-15 rounded-xl overflow-hidden bg-content-hover-background border border-surface shrink-0 flex items-center justify-center relative"
            >
              <img
                v-if="row.thumbnailUrl"
                :src="row.thumbnailUrl"
                class="w-full h-full object-cover"
                alt=""
                :crossorigin="row.crossorigin"
                @error="(event) => handleImageError(event, row.contribution.id)"
                @load="() => handleImageLoad(row.contribution.id)"
              />
              <i
                v-else-if="row.contribution.type === 'standalone'"
                class="pi pi-building text-2xl text-primary-color"
              ></i>
              <i
                v-else-if="imageErrors[row.contribution.id]"
                class="pi pi-image text-2xl text-muted-color"
              ></i>
            </div>

            <!-- Contribution info -->
            <div class="flex-1 min-w-0">
              <h2
                class="text-[13px] md:text-sm font-semibold truncate leading-tight mb-0.5"
                :class="row.contribution.name ? 'text-color' : 'text-muted-color italic'"
              >
                {{
                  row.contribution.name ||
                  (row.contribution.type === "overlay"
                    ? t("overlay.untitled")
                    : t("project.unnamed"))
                }}
              </h2>
              <div class="text-xs text-muted-color truncate mb-0.5">
                {{ getLocationDisplay(row.contribution) }}
              </div>
              <div class="text-xs text-muted-color">
                {{ formatRelativeTime(row.contribution.updatedAt, t) }}
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

    <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { toastWarn } from "@/services/core/toast";

import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";
import {
  contributions,
  isLoading,
  fetchLatestContributions,
} from "@/services/feed/latestContributions";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { useMapStore } from "@/stores/mapStore";

import { useScrollFade } from "@/composables/ui/useScrollFade";
import {
  navigateToProject,
  navigateToProjectBounds,
  zoomToOverlayAndSelect,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { LngLatBounds } from "maplibre-gl";

const { t, locale } = useI18n();
const mapStore = useMapStore();

const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();

function getContributionImageUrl(filename: string): string {
  return buildThumbnailUrl(filename);
}

// Overlays use their own image; standalone projects fall back to their render thumbnail (if any).
function getThumbnailFilename(contribution: LatestContribution): string | null {
  if (contribution.type === "overlay") {
    return contribution.filename;
  }
  return contribution.renderFilename;
}

// Resolve the thumbnail URL and crossorigin flag once per contribution, instead of recomputing
// them several times each in the template.
const rows = computed(() =>
  contributions.value.map((contribution) => {
    const filename = getThumbnailFilename(contribution);
    const thumbnailUrl = filename ? getContributionImageUrl(filename) : null;
    return {
      contribution,
      thumbnailUrl,
      crossorigin:
        thumbnailUrl && imageRequiresCredentials(thumbnailUrl)
          ? ("use-credentials" as const)
          : undefined,
    };
  }),
);

// Prefer the name in the current UI locale, falling back to English, then the boundary's local name.
function localizedName(level: LatestContribution["city"]): string | null {
  if (!level) {
    return null;
  }
  return level.names?.[locale.value] ?? level.nameEn ?? level.name;
}

// Builds "City, State, Country (CODE)" from the boundary-derived levels, skipping missing levels and
// collapsing duplicate names (city-states like Berlin repeat the same name across levels).
function getLocationDisplay(contribution: LatestContribution): string {
  const parts: string[] = [];
  for (const level of [contribution.city, contribution.state, contribution.country]) {
    const name = localizedName(level);
    if (name && !parts.includes(name)) {
      parts.push(name);
    }
  }
  const place = parts.join(", ");
  if (place && contribution.countryCode) {
    return `${place} (${contribution.countryCode})`;
  }
  if (place) {
    return place;
  }
  if (contribution.countryCode) {
    return contribution.countryCode;
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
      toastWarn(t("moderation.noAccessToThisCountry"), t("moderation.title"));
      return;
    }
    mapStore.setSelectedCountryCode(contribution.countryCode);
  }

  if (contribution.type === "overlay") {
    if (contribution.corners) {
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
      navigateToProjectBounds(bounds, contribution.id);
    } else if (typeof contribution.lat === "number" && typeof contribution.lng === "number") {
      navigateToProject(contribution.lat, contribution.lng, contribution.id);
    }
  }
}

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

onMounted(() => {
  fetchLatestContributions();
});
</script>
