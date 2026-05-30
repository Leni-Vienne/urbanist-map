<template>
  <AccordionContent>
    <div
      class="cursor-pointer transition-all duration-150 hover:bg-content-hover-background active:scale-[0.99] rounded-lg"
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
          <div v-if="project.tags && project.tags.length > 0" class="flex flex-wrap gap-1.5 mb-3">
            <span
              v-for="tag in project.tags"
              :key="tag"
              class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              :style="getTagStyle(tag)"
            >
              {{ $te(`tags.${tag}`) ? $t(`tags.${tag}`) : tag }}
            </span>
          </div>
          <div class="flex flex-col gap-2">
            <div
              v-if="project.timelineStatus"
              class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)"
            >
              <i class="pi pi-flag text-xs text-muted-color w-3.5 shrink-0"></i>
              <span>{{
                $te(`timelineStatus.${project.timelineStatus}`)
                  ? $t(`timelineStatus.${project.timelineStatus}`)
                  : project.timelineStatus
              }}</span>
            </div>
            <div
              v-if="contributorDate"
              class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary)"
            >
              <i class="pi pi-pencil text-xs text-muted-color w-3.5 shrink-0"></i>
              <ContributorInfo
                :date="contributorDate"
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
              <span>{{ formatProjectDateRange(project, $t) }}</span>
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

      <div class="cursor-default" @click.stop>
        <ChangeRequestSection
          v-if="projectChanges.length > 0"
          :changes="projectChanges"
          :all-change-requests="allChangeRequests"
          :projects="projectsContext"
          :is-my-contributions="isContributePanel"
          :on-navigate-to-overlay="onNavigateToOverlay"
          :show-user-stats-link="showUserStatsLink"
          @show-user-stats="(data) => $emit('show-user-stats', data)"
          container-class="py-[0.5625rem] px-[0.6875rem] bg-[var(--p-content-hover-background)] border border-surface rounded-lg"
        >
          <template #change-actions="{ change }">
            <slot name="change-actions" :change="change"></slot>
          </template>
        </ChangeRequestSection>
      </div>
    </div>

    <!-- Separator between project info and overlays -->
    <div v-if="shouldShowOverlays" class="border-t border-surface mx-2 mb-1"></div>

    <!-- Project overlays -->
    <div v-if="shouldShowOverlays" class="flex flex-col">
      <div
        v-for="overlay in project.overlays"
        :key="overlay.id"
        :data-overlay-id="overlay.id"
        class="flex flex-col transition-all duration-150"
        :class="
          getOverlayChangeRequestsForOverlay(overlay.id).length > 0
            ? 'bg-orange-50 dark:bg-orange-400/12 rounded-xl my-1'
            : ''
        "
      >
        <div
          class="group flex items-center gap-3 pt-1 pr-2 pb-2 pl-4 cursor-pointer transition-all duration-150 active:scale-[0.98] rounded-xl"
          :class="
            getOverlayChangeRequestsForOverlay(overlay.id).length > 0
              ? 'hover:bg-orange-100 active:bg-orange-100 dark:hover:bg-orange-400/20 dark:active:bg-orange-400/20'
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
              :alt="overlay.caption ?? undefined"
              class="w-full h-full object-cover"
              :crossorigin="
                imageRequiresCredentials(
                  overlay.imageUrl || getOverlayImageUrl(overlay.filename, overlay.status),
                )
                  ? 'use-credentials'
                  : undefined
              "
              @error="(event) => handleImageError(event, overlay.id)"
              @load="() => handleImageLoad(overlay.id)"
            />
            <i v-if="imageErrors[overlay.id]" class="pi pi-image text-2xl text-muted-color"></i>
          </div>

          <!-- Overlay info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p
                :class="[
                  'text-[15px] font-bold m-0 leading-tight flex-1 min-w-0 truncate',
                  overlay.caption ? 'text-color' : 'italic text-muted-color',
                ]"
              >
                {{ overlay.caption || $t("overlay.untitled") }}
              </p>
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
                :value="$t(`approvalStatus.${overlay.status ?? 'draft'}`)"
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
          <i
            v-else
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150 group-hover:text-(--p-text-color-secondary)"
          ></i>
        </div>

        <div class="cursor-default" @click.stop>
          <ChangeRequestSection
            v-if="getOverlayChangeRequestsForOverlay(overlay.id).length > 0"
            :changes="getOverlayChangeRequestsForOverlay(overlay.id)"
            :all-change-requests="allChangeRequests"
            :projects="projectsContext"
            :is-my-contributions="isContributePanel"
            :is-overlay-changes="true"
            :entity-name="overlay.caption || $t('overlay.untitled')"
            :on-navigate-to-overlay="onNavigateToOverlay"
            :show-user-stats-link="showUserStatsLink"
            @show-user-stats="(data) => $emit('show-user-stats', data)"
            container-class="mt-0 pt-2 px-[0.6875rem] pb-[0.6875rem] bg-[var(--p-orange-25)] border-t border-t-[var(--p-orange-200)] mx-1 mb-1 rounded-b-lg"
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
import { PROJECT_TAG_MAP } from "@/config/projectTags";

const { handleOverlayClickNavigation } = useOverlayClickHandler();

function getTagStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: "#64748b", color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

interface Props {
  project: ProjectForModeration;
  projectChanges: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  overlayChangesMap?: Map<string, PendingChangeRequest[]>;
  projectsContext: ProjectForModeration[];
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

// OSM-imported projects expose updatedAt as the import date, which carries no
// meaning for users. Show the source's own last-modified date instead, and hide
// the line entirely when that date is unknown.
const isOsmImport = computed(() => props.project.importSource?.type === "osm");
const contributorDate = computed(() =>
  isOsmImport.value ? props.project.externalLastModified : props.project.updatedAt,
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
  if (props.overlayChangesMap) {
    return props.overlayChangesMap.get(overlayId) || [];
  }

  const overlay = props.project.overlays?.find((o) => o.id === overlayId) || null;

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
</script>
