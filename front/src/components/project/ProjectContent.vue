<template>
  <component
    :is="plain ? 'div' : AccordionContent"
    :class="plain ? 'project-content-plain' : undefined"
  >
    <div
      class="cursor-pointer transition-all duration-150 hover:bg-content-hover-background active:scale-[0.99] rounded-lg"
      @click="handleCardClick"
      @mouseenter="$emit('highlight-project', project)"
      @mouseleave="$emit('remove-project-highlight', project)"
    >
      <div class="flex flex-row items-start gap-y-3">
        <div class="flex-1 min-w-0">
          <ProjectMetadataCard :project="project" show-wikidata-media />

          <!-- Contributor line: accordion-only context the metadata card omits -->
          <div
            v-if="contributorDate"
            class="flex items-center gap-2 text-[13px] text-(--p-text-color-secondary) mt-3"
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
        </div>

        <!-- Actions column - navigation chevron (inline action buttons render at card bottom) -->
        <div class="flex flex-col gap-1.5 shrink-0 self-center" @click.stop>
          <i
            v-if="!hideChevron"
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150"
          ></i>
        </div>
      </div>

      <!-- Inline action buttons row, aligned to the bottom of the card -->
      <div
        v-if="$slots['project-actions']"
        class="flex flex-row flex-wrap gap-1.5 mt-3 py-1"
        @click.stop
      >
        <slot name="project-actions" :project="project"></slot>
      </div>

      <div class="cursor-default" @click.stop>
        <ChangeRequestSection
          v-if="projectChanges.length > 0"
          :changes="projectChanges"
          :project="project"
          :is-my-contributions="isContributePanel"
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
        v-for="overlay in project.overlays ?? []"
        :key="overlay.id"
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
          @click="handleOverlayCardClick(overlay)"
          @mouseenter="$emit('highlight-overlay', overlay.id)"
          @mouseleave="$emit('remove-highlight', overlay.id)"
        >
          <!-- Overlay thumbnail (click to view the full image, e.g. renders that have no map view) -->
          <div
            class="w-15 h-15 rounded-xl overflow-hidden bg-content-hover-background flex items-center justify-center shrink-0"
            :class="!imageErrors[overlay.id] ? 'cursor-zoom-in' : ''"
            @click.stop="!imageErrors[overlay.id] && openLightbox(overlay)"
            v-tooltip.top="!imageErrors[overlay.id] ? $t('overlay.viewFullImage') : undefined"
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
              @error="() => handleImageError(overlay.id)"
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
                {{
                  overlay.caption ||
                  (overlay.kind === "render" ? $t("render.label") : $t("overlay.untitled"))
                }}
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
                :value="$t(`approvalStatus.${overlay.status ?? 'draft'}`)"
                :severity="getStatusSeverity(overlay.status)"
                class="mr-2 capitalize"
                rounded
              />
              <button
                v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
                class="inline-flex items-center gap-1 py-1 px-2 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-400/12 border border-purple-200 dark:border-purple-400/40 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap hover:bg-purple-100 dark:hover:bg-purple-400/20 hover:border-purple-300 dark:hover:border-purple-400/60 hover:text-purple-800 dark:hover:text-purple-200"
                @click.stop="viewOriginalOverlay(overlay.replacesOverlayId)"
                v-tooltip.top="$t('overlay.viewOriginalOverlay')"
              >
                <i class="pi pi-arrow-up-left text-2.5"></i>
                {{ $t("overlay.replaces") }}
              </button>
            </div>
          </div>

          <!-- Overlay action buttons slot -->
          <div class="flex flex-col gap-2" @click.stop>
            <slot name="overlay-actions" :overlay="overlay" :project="project"></slot>
          </div>
        </div>

        <div class="cursor-default" @click.stop>
          <ChangeRequestSection
            v-if="getOverlayChangeRequestsForOverlay(overlay.id).length > 0"
            :changes="getOverlayChangeRequestsForOverlay(overlay.id)"
            :overlay="overlay"
            :is-my-contributions="isContributePanel"
            :is-overlay-changes="true"
            :entity-name="overlay.caption || $t('overlay.untitled')"
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

    <!-- Full-image lightbox, opened from an overlay thumbnail -->
    <ImageLightbox ref="lightbox" />
  </component>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { AccordionContent } from "primevue";
import { useI18n } from "vue-i18n";
import { viewOriginalOverlay } from "@/services/overlay/navigation";
import { buildImageUrl, buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import type { Project, Overlay, PendingChangeRequest, UserStatsPayload } from "@/types/index";
import { getStatusSeverity } from "@/utils/statusHelpers";

import ContributorInfo from "@/components/common/ContributorInfo.vue";
import ChangeRequestSection from "@/components/layout/ChangeRequestSection.vue";
import ImageLightbox from "@/components/common/ImageLightbox.vue";
import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t } = useI18n();

interface Props {
  project: Project;
  projectChanges: PendingChangeRequest[];
  overlayChangesMap: Map<string, PendingChangeRequest[]>;
  isContributePanel: boolean;
  showUserStatsLink?: boolean;
  // Hide the project-level navigation chevron (e.g. in the "selected project" card).
  hideChevron?: boolean;
  // Render as a plain card (a <div>) instead of an AccordionContent, for use outside an Accordion.
  plain?: boolean;
  onOverlayClick: (overlay: Overlay) => Promise<void>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "show-user-stats": [data: UserStatsPayload];
  "project-click": [project: Project];
  "highlight-project": [project: Project];
  "remove-project-highlight": [project: Project];
  "highlight-overlay": [overlayId: string];
  "remove-highlight": [overlayId: string];
}>();

const { imageErrors, handleImageError } = useImageErrors();

// OSM-imported projects have no on-site contributor and their updatedAt is just
// the import date, so the contributor line carries no meaning: hide it for them.
const contributorDate = computed(() =>
  props.project.importSource?.type === "osm" ? null : props.project.updatedAt,
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
  overlay: Overlay,
  data: { userId: string; username: string | null; reportCount: number },
) {
  handleContributorClick(data, overlay.authorApprovedCount, overlay.authorRejectedCount);
}

async function handleOverlayCardClick(overlay: Overlay) {
  // Renders aren't georeferenced, so they open in the lightbox instead of navigating on the map.
  if (overlay.kind === "render") {
    openLightbox(overlay);
    return;
  }

  await props.onOverlayClick(overlay);
}

function getOverlayChangeRequestsForOverlay(overlayId: string): PendingChangeRequest[] {
  return props.overlayChangesMap.get(overlayId) || [];
}

function getOverlayImageUrl(filename: string, status?: string | null): string {
  const forceBackendUrl = status === "pending" || status === null;
  return buildThumbnailUrl(filename, forceBackendUrl);
}

// Full-image lightbox for inspecting an overlay/render beyond its sidebar thumbnail.
const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");

function openLightbox(overlay: Overlay): void {
  if (!overlay.filename && !overlay.imageUrl) return;
  const forceBackendUrl = overlay.status === "pending" || overlay.status === null;
  const url = overlay.imageUrl || buildImageUrl(overlay.filename, forceBackendUrl);
  lightbox.value?.open({
    url,
    header:
      overlay.caption || (overlay.kind === "render" ? t("render.label") : t("overlay.untitled")),
    crossorigin: imageRequiresCredentials(url) ? "use-credentials" : undefined,
  });
}
</script>

<style scoped>
/* Mirror the .p-accordioncontent-content padding so the plain card matches accordion cards. */
.project-content-plain {
  display: block;
  padding: 0.5rem 0.5rem 0.5rem;
}
</style>
