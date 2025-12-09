<template>
  <div class="latest-contributions-panel">
    <div class="panel-content">
      <!-- AI : Panel header with New Project button -->
      <div class="panel-header">
        <Button
          @click="handleAddOverlayClick"
          severity="primary"
          size="small"
          icon="pi pi-plus"
          :label="$t('common.add')"
          class="add-project-button"
        />
      </div>

      <div class="contributions-list" v-if="contributions.length > 0">
        <!-- AI : Clean borderless cards for both overlays and standalone projects -->
        <div
          v-for="contribution in contributions"
          :key="contribution.id"
          class="contribution-card"
          @click="handleContributionClick(contribution)"
          @mouseenter="handleContributionHover(contribution)"
          @mouseleave="handleContributionLeave(contribution)"
        >
          <!-- AI : Contribution thumbnail image (overlay) or icon (st) -->
          <div class="contribution-thumbnail">
            <img
              v-if="contribution.type === 'overlay' && contribution.filename"
              :src="getContributionImageUrl(contribution.filename)"
              :alt="contribution.name"
              class="w-full h-full object-cover"
              @error="(event) => handleImageError(event, contribution.id)"
              @load="(event) => handleImageLoad(event, contribution.id)"
            />
            <!-- AI : Standalone project icon -->
            <i
              v-else-if="contribution.type === 'standalone'"
              class="pi pi-building text-2xl text-primary-500"
            ></i>
            <!-- AI : Fallback icon if image fails -->
            <i
              v-else-if="imageErrors[contribution.id]"
              class="pi pi-image text-2xl text-surface-400"
            ></i>
          </div>

          <!-- AI : Contribution info -->
          <div class="contribution-info">
            <h2 class="contribution-name">{{ contribution.name }}</h2>
            <div class="contribution-time">{{ formatRelativeTime(contribution.updatedAt, t) }}</div>
            <div class="contribution-location">
              <i class="pi pi-map-marker"></i>
              <img
                v-if="contribution.countryCode"
                :src="getFlagUrl(contribution.countryCode)"
                :alt="contribution.countryCode"
                class="country-flag"
                @error="hideFlagOnError"
              />
              <span>{{ getLocationDisplay(contribution) }}</span>
            </div>
          </div>

          <!-- AI : Chevron indicator for clickability -->
          <i class="pi pi-chevron-right tap-indicator"></i>
        </div>
      </div>

      <div
        v-else-if="!isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-image text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">{{ t('contribution.noContributionsFound') }}</p>
        <p class="text-sm">{{ t('contribution.beFirstToAdd') }}</p>
      </div>

      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ t('contribution.loadingContributions') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLatestContributions } from '@/composables/overlay/useLatestContributions'
import { useOverlayClickHandler } from '@/composables/overlay/useOverlayClickHandler'
import { useAddOverlay } from '@/composables/overlay/useAddOverlay'
import { highlightOverlayById, removeOverlayHighlight } from '@/composables/overlay/useOverlaySelection'
import { navigateToStandaloneProject } from '@/composables/navigation/useOverlayNavigation'
import { buildThumbnailUrl } from '@/utils/imageUrl'
import { formatRelativeTime } from '@/utils/dateFormat'
import { getFlagUrl, hideFlagOnError, useImageErrors } from '@/utils/imageHelpers'
import type { LatestContribution } from '@/types/api'

const { t } = useI18n()

// AI : Use cached composable for latest contributions
const { contributions, isLoading, fetchLatestContributions } = useLatestContributions()

// AI : Use shared overlay click handler for overlay navigation
const { handleOverlayClickNavigation } = useOverlayClickHandler()

// AI : Use shared composable for add overlay button
const { handleAddOverlayClick } = useAddOverlay()

// AI : Use shared image error handling
const { imageErrors, handleImageError, handleImageLoad } = useImageErrors()

// AI : Get contribution thumbnail URL using the utility function
function getContributionImageUrl(filename: string): string {
  return buildThumbnailUrl(filename)
}

// AI : Get location display (city, country)
function getLocationDisplay(contribution: LatestContribution): string {
  if (contribution.cityName && contribution.countryName) {
    return `${contribution.cityName}, ${contribution.countryName}`
  } else if (contribution.cityName) {
    return contribution.cityName
  } else if (contribution.countryName) {
    return contribution.countryName
  }
  return t('overlay.unknownLocation')
}

// AI : Handle contribution hover - highlight overlay on map if loaded
function handleContributionHover(contribution: LatestContribution) {
  if (contribution.type === 'overlay') {
    highlightOverlayById(contribution.id)
  }
}

// AI : Handle contribution leave - remove overlay highlight
function handleContributionLeave(contribution: LatestContribution) {
  if (contribution.type === 'overlay') {
    removeOverlayHighlight(contribution.id)
  }
}

// AI : Handle contribution click - navigate to overlay or standalone project
async function handleContributionClick(contribution: LatestContribution) {
  if (contribution.type === 'overlay') {
    // AI : Use existing overlay navigation - don't auto-select, let user click overlay
    await handleOverlayClickNavigation(contribution, false, false)
  } else if (contribution.type === 'standalone') {
    // AI : Navigate to standalone project using full navigation flow (tile layer, city load, etc.)
    if (contribution.cityId && contribution.lat && contribution.lng) {
      await navigateToStandaloneProject(
        contribution.lat,
        contribution.lng,
        contribution.cityId,
        contribution.cityName ?? '',
        contribution.countryCode ?? undefined,
        contribution.id
      )
    }
  }
}

// AI : Load initial data
onMounted(() => {
  fetchLatestContributions()
})
</script>

<style scoped>
/* AI : Import shared panel CSS */
@import '../../assets/panel-common.css';

/* AI : Latest contributions panel with prototype-inspired design */
.latest-contributions-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  padding: 0;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

/* AI : Panel header with Add Overlay button */
.panel-header {
  padding: 1rem 1rem 0rem 1rem;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* AI : Contributions list container */
.contributions-list {
  flex: 1;
  padding: 1rem 0 1rem 1rem;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

/* AI : Clean borderless contribution cards */
.contribution-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 0;
}

.contribution-card:hover {
  background-color: var(--p-surface-50);
}

/* AI : Contribution thumbnail */
.contribution-thumbnail {
  width: 60px;
  height: 60px;
  border-radius: 0.375rem;
  overflow: hidden;
  background-color: var(--p-surface-100);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

/* AI : Contribution info section */
.contribution-info {
  flex: 1;
  min-width: 0;
}

.contribution-name {
  font-size: 0.9375rem;
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contribution-time {
  font-size: 0.75rem;
  color: var(--p-surface-500);
}

.contribution-location {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--p-surface-600);
  margin-bottom: 0.25rem;
}

.contribution-location i {
  color: var(--p-surface-500);
  font-size: 0.625rem;
}

.country-flag {
  width: 16px;
  height: 12px;
  border-radius: 0.125rem;
  flex-shrink: 0;
}

/* AI : Chevron tap indicator - subtle hint that card is clickable */
.tap-indicator {
  color: var(--p-surface-400);
  font-size: 0.875rem;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.contribution-card:hover .tap-indicator {
  color: var(--p-surface-600);
}

/* AI : Mobile active state for touch feedback */
.contribution-card:active {
  background-color: var(--p-surface-100);
  transform: scale(0.98);
}


/* AI : Mobile responsive adjustments */
@media (max-width: 768px) {

  .contribution-card {
    padding: 0.625rem;
    gap: 0.625rem;
  }

  .contribution-thumbnail {
    width: 50px;
    height: 50px;
  }

  .contribution-name {
    font-size: 0.8125rem;
  }
}
</style>
