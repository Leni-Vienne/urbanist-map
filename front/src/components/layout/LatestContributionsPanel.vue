<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 flex flex-col">
      <div v-if="contributions.length > 0" class="flex-1 flex flex-col px-4 py-3">
        <div
          v-for="contribution in contributions"
          :key="contribution.id"
          class="group flex items-center gap-3 py-2 cursor-pointer transition-all duration-150 hover:bg-content-hover-background active:bg-content-hover-background active:scale-[0.98]"
          @click="handleContributionClick(contribution)"
          @mouseenter="handleContributionHover(contribution)"
          @mouseleave="handleContributionLeave(contribution)"
        >
          <!-- Contribution thumbnail image (overlay) or icon (standalone) -->
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
              @load="(event) => handleImageLoad(event, contribution.id)"
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
              class="text-[13px] md:text-sm font-semibold text-color truncate leading-tight mb-0.5"
            >
              {{ contribution.name }}
            </h2>
            <div class="text-xs text-muted-color truncate mb-0.5">
              {{ getLocationDisplay(contribution) }}
            </div>
            <div class="text-xs text-muted-color">
              {{ formatRelativeTime(contribution.updatedAt, t) }}
            </div>
          </div>

          <!-- Chevron indicator for clickability -->
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
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useLatestContributions } from "@/composables/overlay/useLatestContributions";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useToast } from "@/composables/ui/useToast";
import type { LatestContribution } from "@/types/index";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/overlaySelection";

const { t } = useI18n();
const overlayStore = useOverlayStore();
const toast = useToast();

// Use cached composable for latest contributions
const { contributions, isLoading, fetchLatestContributions } = useLatestContributions();

// Use shared image error handling
const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();

// Get contribution thumbnail URL using the utility function
function getContributionImageUrl(filename: string): string {
  return buildThumbnailUrl(filename);
}

// Get location display (city, country)
function getLocationDisplay(contribution: LatestContribution): string {
  if (contribution.cityName && contribution.countryName) {
    return `${contribution.cityName}, ${contribution.countryName}`;
  } else if (contribution.cityName) {
    return contribution.cityName;
  } else if (contribution.countryName) {
    return contribution.countryName;
  }
  return t("overlay.unknownLocation");
}

// Handle contribution hover - highlight overlay on map if loaded
function handleContributionHover(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    highlightOverlayById(contribution.id);
  }
}

// Handle contribution leave - remove overlay highlight
function handleContributionLeave(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    removeOverlayHighlight(contribution.id);
  }
}

// Handle contribution click - navigate to overlay or standalone project
async function handleContributionClick(contribution: LatestContribution) {
  // In moderation mode, auto-select the country for the moderation panel
  // Block navigation if the moderator can't moderate this country
  if (overlayStore.mode === "moderation" && contribution.countryCode) {
    const { canModerateCountry, syncModerationCountry } =
      await import("@/composables/overlay/useOverlayClickHandler");
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
    const { useOverlayClickHandler } = await import("@/composables/overlay/useOverlayClickHandler");
    const { handleOverlayClickNavigation } = useOverlayClickHandler();
    await handleOverlayClickNavigation(contribution, false, true);
  } else if (contribution.type === "standalone") {
    // Navigate to standalone project using full navigation flow (tile layer, city load, etc.)
    if (contribution.cityId && contribution.lat && contribution.lng) {
      const { navigateToStandaloneProject } =
        await import("@/services/navigation/projectNavigation");
      await navigateToStandaloneProject(
        contribution.lat,
        contribution.lng,
        contribution.cityId,
        contribution.cityName ?? "",
        contribution.countryCode ?? undefined,
        contribution.id,
      );
    }
  }
}

// Load initial data
onMounted(() => {
  fetchLatestContributions();
});
</script>
