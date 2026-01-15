<template>
  <AccordionContent>
    <Card class="marker-project-card" @click="handleCardClick">
      <template #content>
        <div class="project-content-wrapper">
          <div class="project-info-section">
            <div v-if="project.description" class="project-description">
              <p>{{ project.description }}</p>
            </div>
            <div class="project-metadata">
              <div class="metadata-item">
                <i class="pi pi-clock"></i>
                <ContributorInfo
                  :date="project.updatedAt"
                  :contributor-id="project.ownerId"
                  :contributor-username="project.ownerUsername"
                  :report-count="project.ownerReportCount ?? 0"
                  :clickable="showUserStatsLink && !!project.ownerId"
                  @click-contributor="handleProjectContributorClick"
                />
              </div>
              <div class="metadata-item" v-if="project.cityName || project.countryName">
                <i class="pi pi-map-marker"></i>
                <ClickableLocation
                  :city-id="project.cityId"
                  :city-name="project.cityName"
                  :country-code="project.countryCode"
                  :country-name="project.countryName"
                />
              </div>
              <div class="metadata-item">
                <i class="pi pi-images"></i>
                <span
                  >{{ project.overlayCount || (project.overlays ? project.overlays.length : 0) }}
                  {{ $t("overlay.overlayImages") }}</span
                >
              </div>
              <div
                class="metadata-item"
                v-if="project.startDate || project.endDate || project.proposalDate"
              >
                <i class="pi pi-calendar"></i>
                <span>{{
                  formatProjectDateRange(project.startDate, project.endDate, project.proposalDate)
                }}</span>
              </div>
              <div class="metadata-item" v-if="project.sourceUrl">
                <i class="pi pi-link"></i>
                <a :href="project.sourceUrl" target="_blank" class="app-link" @click.stop>
                  {{ formatSourceUrl(project.sourceUrl) }}
                </a>
              </div>
            </div>
          </div>

          <!-- AI : Actions column - either slot actions, edit button, or chevron indicator -->
          <div class="project-actions-column" @click.stop>
            <!-- AI : Project actions slot for moderation panel -->
            <slot v-if="$slots['project-actions']" name="project-actions" :project="project"></slot>

            <!-- AI : Edit button if showEditButtons prop is true and no slot actions -->
            <button
              v-else-if="showEditButtons"
              class="action-btn edit-btn"
              @click.stop="$emit('edit-project', project)"
              v-tooltip.top="$t('common.edit')"
            >
              <i class="pi pi-pencil"></i>
            </button>

            <!-- AI : Chevron indicator for all projects when no action buttons - signals clickability -->
            <i v-else class="pi pi-chevron-right tap-indicator"></i>
          </div>
        </div>

        <ChangeRequestSection
          v-if="projectChanges.length > 0"
          :changes="projectChanges"
          :all-change-requests="allChangeRequests"
          :projects="projectsContext"
          :is-my-contributions="isContributePanel"
          :on-navigate-to-overlay="onNavigateToOverlay"
          :show-user-stats-link="showUserStatsLink"
          @show-user-stats="(data) => $emit('show-user-stats', data)"
          container-class="project-change-requests"
        >
          <template #change-actions="{ change }">
            <slot name="change-actions" :change="change"></slot>
          </template>
        </ChangeRequestSection>
      </template>
    </Card>

    <!-- AI : Project overlays with borderless design -->
    <div v-if="shouldShowOverlays" class="flex flex-col mt-4">
      <div
        v-for="overlay in project.overlays"
        :key="overlay.id"
        :data-overlay-id="overlay.id"
        class="overlay-card-wrapper"
        :class="{
          'has-changes': getOverlayChangeRequestsForOverlay(overlay.id).length > 0,
        }"
      >
        <div
          class="overlay-card"
          @click="handleOverlayCardClick(overlay, true)"
          @mouseenter="$emit('highlight-overlay', overlay.id)"
          @mouseleave="$emit('remove-highlight', overlay.id)"
        >
          <!-- AI : Overlay thumbnail -->
          <div
            class="w-15 h-15 rounded-md overflow-hidden bg-surface-100 flex items-center justify-center flex-shrink-0"
          >
            <img
              v-if="!imageErrors[overlay.id]"
              :src="overlay.imageUrl || getOverlayImageUrl(overlay.filename, overlay.status)"
              :alt="overlay.name"
              class="w-full h-full object-cover"
              :crossorigin="
                imageRequiresCredentials(
                  overlay.imageUrl || getOverlayImageUrl(overlay.filename, overlay.status),
                )
                  ? 'use-credentials'
                  : undefined
              "
              @error="(event) => handleImageError(event, overlay.id)"
              @load="(event) => handleImageLoad(event, overlay.id)"
            />
            <i v-if="imageErrors[overlay.id]" class="pi pi-image text-2xl text-surface-400"></i>
          </div>

          <!-- AI : Overlay info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p class="overlay-name">
                {{ overlay.name || $t("overlay.untitled") }}
              </p>
            </div>
            <div class="flex items-center gap-1.5 text-surface-600 text-xs mb-1">
              <i class="pi pi-map-marker text-surface-500"></i>

              <span class="truncate">{{ getOverlayLocationDisplay(overlay) }}</span>
            </div>
            <div class="text-xs text-surface-500 mb-2">
              <ContributorInfo
                :date="overlay.updatedAt"
                :contributor-id="overlay.authorId"
                :contributor-username="overlay.authorUsername"
                :report-count="overlay.authorReportCount ?? 0"
                :clickable="showUserStatsLink && !!overlay.authorId"
                @click-contributor="handleOverlayContributorClick(overlay, $event)"
              />
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <Tag
                v-if="!hideStatusBadges"
                :value="$t(`status.${overlay.status ?? 'draft'}`)"
                :severity="getStatusSeverity(overlay.status)"
                class="overlay-status-tag"
                rounded
              />
              <button
                v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
                class="replacement-badge"
                @click.stop="onNavigateToOverlay(overlay.replacesOverlayId)"
                v-tooltip.top="$t('overlay.viewOriginalOverlay')"
              >
                <i class="pi pi-arrow-up-left"></i>
                {{ $t("overlay.replaces") }}
              </button>
            </div>
          </div>

          <!-- AI : Overlay action buttons slot -->
          <div v-if="$slots['overlay-actions']" class="flex flex-col gap-2" @click.stop>
            <slot name="overlay-actions" :overlay="overlay" :project="project"></slot>
          </div>

          <!-- AI : Edit button if showEditButtons prop is true and no slot actions -->
          <button
            v-else-if="showEditButtons"
            class="action-btn edit-btn"
            @click.stop=""
            v-tooltip.top="$t('common.edit')"
          >
            <i class="pi pi-pencil"></i>
          </button>

          <!-- AI : Chevron indicator when no action buttons -->
          <i v-else class="pi pi-chevron-right tap-indicator"></i>
        </div>

        <ChangeRequestSection
          v-if="getOverlayChangeRequestsForOverlay(overlay.id).length > 0"
          :changes="getOverlayChangeRequestsForOverlay(overlay.id)"
          :all-change-requests="allChangeRequests"
          :projects="projectsContext"
          :is-my-contributions="isContributePanel"
          :is-overlay-changes="true"
          :entity-name="overlay.name || $t('overlay.untitled')"
          :on-navigate-to-overlay="onNavigateToOverlay"
          :show-user-stats-link="showUserStatsLink"
          @show-user-stats="(data) => $emit('show-user-stats', data)"
          container-class="overlay-change-requests"
        >
          <template #change-actions="{ change }">
            <slot name="change-actions" :change="change"></slot>
          </template>
        </ChangeRequestSection>
      </div>
    </div>
  </AccordionContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AccordionContent, Card, Tag } from "primevue";
import { formatSourceUrl } from "@/utils/urlFormat";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { useImageErrors } from "@/utils/imageHelpers";
import type {
  ProjectForModeration,
  OverlayForModeration,
  PendingChangeRequest,
} from "@/types/index";
import { useOverlayClickHandler } from "@/composables/overlay/useOverlayClickHandler";
import { getStatusSeverity } from "@/utils/statusHelpers";

import ContributorInfo from "@/components/common/ContributorInfo.vue";
import ClickableLocation from "@/components/common/ClickableLocation.vue";
import ChangeRequestSection from "@/components/layout/ChangeRequestSection.vue";
import { formatProjectDateRange } from "@/utils/dateFormat";

interface Props {
  project: ProjectForModeration;
  projectChanges: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  overlayChangesMap?: Map<string, PendingChangeRequest[]>;
  projectsContext: ProjectForModeration[]; // Needed for context in change requests
  isContributePanel: boolean;
  showUserStatsLink?: boolean;
  hideStatusBadges?: boolean;
  showEditButtons?: boolean;
  isExpanded?: boolean;
  onNavigateToOverlay: (overlayId: string) => Promise<void>;
  onOverlayClick?: (overlay: OverlayForModeration, shouldFitBounds: boolean) => Promise<void>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "show-user-stats": [
    data: {
      userId: string;
      username?: string | null;
      approvedCount?: number | null;
      rejectedCount?: number | null;
      reportCount?: number;
    },
  ];
  "edit-project": [project: ProjectForModeration];
  "project-click": [project: ProjectForModeration];
  "highlight-overlay": [overlayId: string];
  "remove-highlight": [overlayId: string];
}>();

const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();
const { handleOverlayClickNavigation } = useOverlayClickHandler();

const shouldShowOverlays = computed(() => {
  return props.project.overlays && props.project.overlays.length > 0;
});

// AI : Handle card click - emit event for parent to handle navigation logic
function handleCardClick() {
  emit("project-click", props.project);
}

// AI : Unified contributor click handler
function handleContributorClick(
  data: { userId: string; username: string | null; reportCount: number },
  approvedCount: number | null | undefined,
  rejectedCount: number | null | undefined,
) {
  emit("show-user-stats", {
    userId: data.userId,
    username: data.username,
    approvedCount: approvedCount ?? null,
    rejectedCount: rejectedCount ?? null,
    reportCount: data.reportCount,
  });
}

function handleProjectContributorClick(data: {
  userId: string;
  username: string | null;
  reportCount: number;
}) {
  handleContributorClick(data, props.project.ownerApprovedCount, props.project.ownerRejectedCount);
}

function handleOverlayContributorClick(
  overlay: OverlayForModeration,
  data: { userId: string; username: string | null; reportCount: number },
) {
  handleContributorClick(data, overlay.authorApprovedCount, overlay.authorRejectedCount);
}

async function handleOverlayCardClick(overlay: OverlayForModeration, shouldFitBounds: boolean) {
  if (props.onOverlayClick) {
    await props.onOverlayClick(overlay, shouldFitBounds);
  } else {
    await handleOverlayClickNavigation(overlay, shouldFitBounds);
  }
}

function getOverlayChangeRequestsForOverlay(overlayId: string): PendingChangeRequest[] {
  // AI : Use O(1) map lookup if available
  if (props.overlayChangesMap) {
    return props.overlayChangesMap.get(overlayId) || [];
  }

  // Logic copied from parent
  let overlay: OverlayForModeration | null = null;
  // Search in local project's overlays first (optimization)
  overlay = props.project.overlays?.find((o) => o.id === overlayId) || null;

  if (!overlay) {
    // Fallback search in context if needed, but here we iterate project overlays so it should be there
  }

  if (!overlay || overlay.status === "pending") {
    return [];
  }
  return props.allChangeRequests.filter(
    (request) => request.entityType === "overlay" && request.entityId === overlayId,
  );
}

function getOverlayImageUrl(filename: string, status?: string | null): string {
  const forceBackendUrl = status === "pending" || status === null;
  return buildThumbnailUrl(filename, forceBackendUrl);
}

function getOverlayLocationDisplay(overlay: OverlayForModeration): string {
  const cityName = overlay.cityName;
  const countryName = overlay.countryName;
  if (cityName && countryName) {
    if (cityName.includes(countryName)) return cityName;
    return `${cityName}, ${countryName}`;
  } else if (cityName) return cityName;
  else if (countryName) return countryName;
  return "Unknown Location";
}
</script>

<style scoped>
/* COPIED STYLES FROM ProjectAccordionPanel.vue */

.marker-project-card {
  cursor: pointer;
  transition: all 0.15s ease;
}

.marker-project-card:hover {
  background-color: var(--p-surface-50) !important;
}

.marker-project-card:active {
  background-color: var(--p-surface-100) !important;
  transform: scale(0.98);
}

.project-content-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.75rem;
}

.project-info-section {
  flex: 1;
  min-width: 0;
}

.project-description {
  margin-bottom: 1rem;
}

.project-description p {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--p-surface-700);
  margin: 0;
}

.project-metadata {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.metadata-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--p-surface-600);
}

.metadata-item i {
  color: var(--p-surface-500);
  font-size: 0.75rem;
  width: 14px;
  flex-shrink: 0;
}

.project-actions-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
  align-self: center;
}

.project-actions-column > * {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.875rem;
}

.action-btn:hover {
  border-color: #d1d5db;
  background-color: #f9fafb;
}

/* Overlay Styles */
.overlay-card-wrapper {
  display: flex;
  flex-direction: column;
  transition: all 0.15s ease;
}

.overlay-card-wrapper.has-changes {
  border-left: 3px solid var(--p-orange-400);
  background: var(--p-orange-50);
  border-radius: 4px;
  margin: 0.25rem 0;
}

.overlay-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.5rem 0.5rem 1rem;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 0;
}

.overlay-card:hover {
  background-color: var(--p-surface-50);
}

.overlay-card:active {
  background-color: var(--p-surface-100);
  transform: scale(0.98);
}

.overlay-card:hover .tap-indicator,
.marker-project-card:hover .tap-indicator {
  color: var(--p-surface-600);
}

.overlay-card-wrapper.has-changes .overlay-card {
  background: transparent;
}

.overlay-card-wrapper.has-changes .overlay-card:hover {
  background-color: var(--p-orange-100);
}

.overlay-card .overlay-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--p-surface-900);
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  width: 0;
  flex: 1;
  min-width: 0;
}

.replacement-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-purple-700);
  background-color: var(--p-purple-50);
  border: 1px solid var(--p-purple-200);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.replacement-badge:hover {
  background-color: var(--p-purple-100);
  border-color: var(--p-purple-300);
  color: var(--p-purple-800);
}

.replacement-badge i {
  font-size: 0.625rem;
}

.project-change-requests {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.overlay-change-requests {
  padding: 0.75rem 1rem;
  background: var(--p-orange-25);
  border-top: 1px solid var(--p-orange-200);
}

.overlay-status-tag {
  margin-right: 0.5rem;
  text-transform: capitalize;
}

.app-link {
  color: var(--p-primary-600);
  text-decoration: none;
}

.app-link:hover {
  text-decoration: underline;
}
</style>
