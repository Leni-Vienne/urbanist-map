<template>
  <AccordionContent>
    <div
      class="rounded-lg border border-surface p-3 cursor-pointer transition-all duration-150 hover:border-(--p-text-muted-color) hover:bg-content-background active:bg-content-background active:scale-[0.98]"
      @click="handleCardClick"
      @mouseenter="$emit('highlight-project', project)"
      @mouseleave="$emit('remove-project-highlight', project)"
    >
      <div class="flex flex-row items-start gap-3">
        <div class="flex-1 min-w-0">
          <div v-if="project.description" class="mb-4">
            <p class="text-sm leading-relaxed text-color m-0">
              {{ project.description }}
            </p>
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)">
              <i class="pi pi-clock text-xs text-muted-color w-3.5 shrink-0"></i>
              <ContributorInfo
                :date="project.updatedAt"
                :contributor-id="project.ownerId"
                :contributor-username="project.ownerUsername"
                :report-count="project.ownerReportCount ?? 0"
                :clickable="showUserStatsLink && Boolean(project.ownerId)"
                @click-contributor="handleProjectContributorClick"
              />
            </div>
            <div
              v-if="overlayCount > 0"
              class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)"
            >
              <i class="pi pi-images text-xs text-muted-color w-3.5 shrink-0"></i>
              <span
                >{{ overlayCount }}
                {{
                  overlayCount === 1 ? $t("overlay.overlayImage") : $t("overlay.overlayImages")
                }}</span
              >
            </div>
            <div
              v-if="project.startDate || project.endDate || project.proposalDate"
              class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)"
            >
              <i class="pi pi-calendar text-xs text-muted-color w-3.5 shrink-0"></i>
              <span>{{
                formatProjectDateRange(
                  project.startDate,
                  project.endDate,
                  project.proposalDate,
                  project.startDatePrecision,
                  project.endDatePrecision,
                  project.proposalDatePrecision,
                  $t,
                )
              }}</span>
            </div>
            <div
              v-if="project.sourceUrl"
              class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)"
            >
              <i class="pi pi-link text-xs text-muted-color w-3.5 shrink-0"></i>
              <a
                :href="project.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-color no-underline hover:underline"
                @click.stop
                >{{ formatSourceUrl(project.sourceUrl) }}</a
              >
            </div>
          </div>
        </div>

        <!-- Actions column - either slot actions, edit button, or chevron -->
        <div class="flex flex-col gap-1.5 shrink-0 self-center" @click.stop>
          <slot v-if="$slots['project-actions']" name="project-actions" :project="project"></slot>
          <button
            v-else-if="showEditButtons"
            class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-500 hover:text-primary-600 hover:bg-primary-50 hover:border-primary-200"
            @click.stop="$emit('edit-project', project)"
            v-tooltip.top="$t('common.edit')"
          >
            <i class="pi pi-pencil"></i>
          </button>
          <i
            v-else
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150"
          ></i>
        </div>
      </div>

      <div @click.stop>
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
      </div>
    </div>

    <!-- Project overlays -->
    <div v-if="shouldShowOverlays" class="flex flex-col mt-4">
      <div
        v-for="overlay in project.overlays"
        :key="overlay.id"
        :data-overlay-id="overlay.id"
        class="flex flex-col transition-all duration-150"
        :class="
          getOverlayChangeRequestsForOverlay(overlay.id).length > 0 ? 'pending-overlay-row' : ''
        "
      >
        <div
          class="group flex items-center gap-3 pt-1 pr-2 pb-2 pl-4 cursor-pointer transition-all duration-150 active:scale-[0.98] rounded-xl"
          :class="
            getOverlayChangeRequestsForOverlay(overlay.id).length > 0
              ? 'pending-overlay-hover'
              : 'hover:bg-white dark:hover:bg-white/10 active:bg-white dark:active:bg-white/10'
          "
          @click="handleOverlayCardClick(overlay, true)"
          @mouseenter="$emit('highlight-overlay', overlay.id)"
          @mouseleave="$emit('remove-highlight', overlay.id)"
        >
          <!-- Overlay thumbnail -->
          <div
            class="w-15 h-15 rounded-xl overflow-hidden bg-content-hover-background flex items-center justify-center shrink-0"
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
            <i v-if="imageErrors[overlay.id]" class="pi pi-image text-2xl text-muted-color"></i>
          </div>

          <!-- Overlay info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p
                :class="[
                  'text-[15px] font-bold m-0 leading-tight flex-1 min-w-0 truncate',
                  overlay.name ? 'text-color' : 'italic text-muted-color',
                ]"
              >
                {{ overlay.name || $t("overlay.untitled") }}
              </p>
            </div>
            <div class="flex items-center gap-1.5 text-(--p-text-color-secondary) text-xs mb-1">
              <i class="pi pi-map-marker text-muted-color"></i>
              <span class="truncate">{{ getOverlayLocationDisplay(overlay) }}</span>
            </div>
            <div class="text-xs text-muted-color mb-2">
              <ContributorInfo
                :date="overlay.updatedAt"
                :contributor-id="overlay.authorId"
                :contributor-username="overlay.authorUsername"
                :report-count="overlay.authorReportCount ?? 0"
                :clickable="showUserStatsLink && Boolean(overlay.authorId)"
                @click-contributor="handleOverlayContributorClick(overlay, $event)"
              />
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <Tag
                v-if="!hideStatusBadges"
                :value="$t(`status.${overlay.status ?? 'draft'}`)"
                :severity="getStatusSeverity(overlay.status)"
                class="mr-2 capitalize"
                rounded
              />
              <button
                v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
                class="inline-flex items-center gap-1 py-1 px-2 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap hover:bg-purple-100 hover:border-purple-300 hover:text-purple-800"
                @click.stop="onNavigateToOverlay(overlay.replacesOverlayId)"
                v-tooltip.top="$t('overlay.viewOriginalOverlay')"
              >
                <i class="pi pi-arrow-up-left text-2.5"></i>
                {{ $t("overlay.replaces") }}
              </button>
            </div>
          </div>

          <!-- Overlay action buttons slot -->
          <div v-if="$slots['overlay-actions']" class="flex flex-col gap-2" @click.stop>
            <slot name="overlay-actions" :overlay="overlay" :project="project"></slot>
          </div>
          <button
            v-else-if="showEditButtons"
            class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-500 hover:text-primary-600 hover:bg-primary-50 hover:border-primary-200"
            @click.stop=""
            v-tooltip.top="$t('common.edit')"
          >
            <i class="pi pi-pencil"></i>
          </button>
          <i
            v-else
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150 group-hover:text-(--p-text-color-secondary)"
          ></i>
        </div>

        <div @click.stop>
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
    </div>
  </AccordionContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AccordionContent, Tag } from "primevue";
import { useOverlayClickHandler } from "@/composables/overlay/useOverlayClickHandler";
import { formatSourceUrl } from "@/utils/urlFormat";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import type {
  ProjectForModeration,
  OverlayForModeration,
  PendingChangeRequest,
} from "@/types/index";
import { getStatusSeverity } from "@/utils/statusHelpers";

import ContributorInfo from "@/components/common/ContributorInfo.vue";
import ChangeRequestSection from "@/components/layout/ChangeRequestSection.vue";
import { formatProjectDateRange } from "@/utils/projectDateFormat";

const { handleOverlayClickNavigation } = useOverlayClickHandler();

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
  "highlight-project": [project: ProjectForModeration];
  "remove-project-highlight": [project: ProjectForModeration];
  "highlight-overlay": [overlayId: string];
  "remove-highlight": [overlayId: string];
}>();

const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();

const overlayCount = computed(
  () => props.project.overlayCount || (props.project.overlays?.length ?? 0),
);

const shouldShowOverlays = computed(() => {
  return props.project.overlays && props.project.overlays.length > 0;
});

// Handle card click - emit event for parent to handle navigation logic
function handleCardClick() {
  emit("project-click", props.project);
}

// Unified contributor click handler
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
  // Use O(1) map lookup if available
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
/* Container classes passed as string props to ChangeRequestSection */
.project-change-requests {
  padding: 0.75rem;
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.overlay-change-requests {
  padding: 0.75rem 1rem;
  background: var(--p-orange-25);
  border-top: 1px solid var(--p-orange-200);
}

/* Pending change row — orange accent strip */
.pending-overlay-row {
  /* orange-400 */
  background: #fff7ed;
  /* orange-50 */
  border-radius: 0.25rem;
  margin: 0.25rem 0;
}

.pending-overlay-hover:hover,
.pending-overlay-hover:active {
  background: #ffedd5;
  /* orange-100 */
}
</style>

<!-- Dark mode rules in a non-scoped block to avoid Vue scoping the .dark-mode selector -->
<style>
.dark-mode .pending-overlay-row {
  background: rgba(251, 146, 60, 0.12) !important;
  border-left-color: #f97316 !important;
}

.dark-mode .pending-overlay-hover:hover,
.dark-mode .pending-overlay-hover:active {
  background: rgba(251, 146, 60, 0.2) !important;
}
</style>
