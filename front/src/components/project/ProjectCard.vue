<template>
  <component
    :is="plain ? 'div' : AccordionHeader"
    :class="plain ? 'project-header-plain' : undefined"
  >
    <div class="flex items-center justify-between w-full gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- Wikidata logo (e.g. metro line badge) shown when available -->
        <img
          v-if="wikidataEntity?.logoUrl"
          :src="wikidataEntity.logoUrl"
          class="w-5 h-5 object-contain shrink-0"
          referrerpolicy="no-referrer"
          loading="lazy"
        />
        <span
          class="font-semibold truncate"
          :class="project.name ? '' : 'text-muted-color italic'"
          >{{ project.name || (isOsmImport ? $t("project.osmName") : $t("project.unnamed")) }}</span
        >
      </div>
      <div class="flex items-center gap-1.5 shrink-0 mr-2">
        <!-- Pending change requests badge -->
        <Badge v-if="pendingChangeCount > 0" :value="pendingChangeCount" severity="warn" />
        <!-- OSM-imported projects show their source instead of a moderation status -->
        <Tag
          v-if="isOsmImport"
          v-tooltip.bottom="$t('project.importedTooltip')"
          :value="$t('project.osmSource')"
          severity="info"
          rounded
        />
        <!-- Moderation status badge with tooltip clarifying it is not a timeline status -->
        <Tag
          v-else
          v-tooltip.bottom="$t('approvalStatus.tooltipLabel')"
          :value="$t(`approvalStatus.${project.status ?? 'draft'}`)"
          :severity="getStatusSeverity(project.status)"
          class="capitalize"
          rounded
        />
      </div>
    </div>
  </component>

  <component
    :is="plain ? 'div' : AccordionContent"
    :class="plain ? 'project-content-plain' : undefined"
  >
    <div
      class="cursor-pointer transition-all duration-150 hover:bg-(--p-content-hover-background) active:scale-[0.99] rounded-lg"
      @click="handleCardClick"
      @mouseenter="focusStore.setHoverTarget({ kind: 'project', projectId: project.id })"
      @mouseleave="focusStore.setHoverTarget(null)"
    >
      <div class="flex flex-row items-start gap-y-3">
        <div class="flex-1 min-w-0">
          <ProjectMetadataCard :project="project" show-wikidata-media />

          <p
            v-if="isContributePanel && project.status === 'rejected' && project.rejectionReason"
            class="mt-3 text-sm text-red-600 dark:text-red-400"
          >
            {{ $t("moderation.rejectionReason.label") }}:
            {{ $t(`moderation.rejectionReason.${project.rejectionReason}`) }}
          </p>

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

        <div class="flex flex-col gap-1.5 shrink-0 self-center" @click.stop>
          <i
            v-if="!plain"
            class="pi pi-chevron-right text-sm text-muted-color shrink-0 transition-colors duration-150"
          ></i>
        </div>
      </div>

      <div
        v-if="$slots['project-actions']"
        class="flex flex-row flex-wrap gap-1.5 mt-3 py-1"
        @click.stop
      >
        <slot name="project-actions" :project="project" :is-external="isExternal ?? false"></slot>
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

    <div v-if="shouldShowImages" class="border-t border-surface mx-2 mb-1"></div>

    <div v-if="shouldShowImages" class="flex flex-col">
      <div
        v-for="overlay in overlays"
        :key="overlay.id"
        class="flex flex-col transition-all duration-150"
        :class="
          getOverlayChangeRequests(overlay.id).length > 0
            ? 'bg-orange-50 dark:bg-orange-400/12 rounded-xl my-1'
            : ''
        "
      >
        <div
          class="group flex items-center gap-3 pt-1 pr-2 pb-2 pl-4 cursor-pointer transition-all duration-150 active:scale-[0.98] rounded-xl"
          :class="
            getOverlayChangeRequests(overlay.id).length > 0
              ? 'hover:bg-orange-100 active:bg-orange-100 dark:hover:bg-orange-400/20 dark:active:bg-orange-400/20'
              : 'hover:bg-white dark:hover:bg-white/10 active:bg-white dark:active:bg-white/10'
          "
          @click="handleOverlayCardClick(overlay)"
          @mouseenter="highlightOverlayById(overlay.id)"
          @mouseleave="removeOverlayHighlight(overlay.id)"
        >
          <!-- Overlay thumbnail (click to view the full image, e.g. renders that have no map view) -->
          <div
            class="w-15 h-15 rounded-xl overflow-hidden bg-(--p-content-hover-background) flex items-center justify-center shrink-0"
            :class="!imageErrors[overlay.id] ? 'cursor-zoom-in' : ''"
            @click.stop="!imageErrors[overlay.id] && openOverlayImage(overlay)"
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
                  ((overlay.kind ?? "map") === "render"
                    ? $t("render.label")
                    : $t("overlay.untitled"))
                }}
              </p>
            </div>
            <div
              v-if="
                overlay.updatedAt ||
                overlay.authorUsername ||
                (isContributePanel && overlay.status === null && authStore.user?.username)
              "
              class="text-xs text-muted-color mb-2"
            >
              <ContributorInfo
                :date="overlay.updatedAt"
                :contributor-id="overlay.authorId"
                :contributor-username="
                  overlay.authorUsername ??
                  (isContributePanel && overlay.status === null
                    ? (authStore.user?.username ?? null)
                    : null)
                "
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
                <i class="pi pi-arrow-up-left text-[0.625rem]"></i>
                {{ $t("overlay.replaces") }}
              </button>
            </div>
            <p
              v-if="isContributePanel && overlay.status === 'rejected' && overlay.rejectionReason"
              class="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {{ $t("moderation.rejectionReason.label") }}:
              {{ $t(`moderation.rejectionReason.${overlay.rejectionReason}`) }}
            </p>
          </div>

          <div class="flex flex-col gap-2" @click.stop>
            <slot name="overlay-actions" :overlay="overlay" :project="project"></slot>
          </div>
        </div>

        <div class="cursor-default" @click.stop>
          <ChangeRequestSection
            v-if="getOverlayChangeRequests(overlay.id).length > 0"
            :changes="getOverlayChangeRequests(overlay.id)"
            :overlay="getChangeRequestOverlay(overlay)"
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

      <div
        v-if="localRenderPreviewUrl"
        class="flex items-center gap-3 pt-1 pr-2 pb-2 pl-4 cursor-pointer rounded-xl transition-all duration-150 active:scale-[0.98] hover:bg-white dark:hover:bg-white/10"
        @click="openLocalRenderPreview"
      >
        <img
          :src="localRenderPreviewUrl"
          :alt="$t('render.label')"
          class="w-15 h-15 rounded-xl object-cover shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-[15px] font-bold m-0 mb-2 leading-tight text-color truncate">
            {{ $t("render.label") }}
          </p>
          <Tag :value="$t('approvalStatus.draft')" :severity="getStatusSeverity(null)" rounded />
        </div>
        <slot name="staged-render-actions" :project="project"></slot>
      </div>
    </div>

    <ImageLightbox ref="lightbox" />
  </component>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { AccordionHeader, AccordionContent } from "primevue";
import { useI18n } from "vue-i18n";
import { viewOriginalOverlay } from "@/services/overlay/navigation";
import { buildImageUrl, buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import type {
  Project,
  Overlay,
  ProjectPanelOverlay,
  PendingChangeRequest,
  UserStatsPayload,
} from "@/types/index";
import { getStatusSeverity } from "@/utils/statusHelpers";
import { useAuthStore } from "@/stores/authStore";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import { toastWarn, toastError } from "@/services/core/toast";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { navigateToProject } from "@/services/navigation/projectNavigation";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";

import ContributorInfo from "@/components/common/ContributorInfo.vue";
import ChangeRequestSection from "@/components/layout/ChangeRequestSection.vue";
import ImageLightbox from "@/components/common/ImageLightbox.vue";
import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t } = useI18n();
const authStore = useAuthStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();

interface Props {
  project: Project;
  overlays: ProjectPanelOverlay[];
  localRenderPreviewUrl?: string;
  projectChanges: PendingChangeRequest[];
  overlayChangesMap: Map<string, PendingChangeRequest[]>;
  isContributePanel: boolean;
  showUserStatsLink?: boolean;
  isExternal?: boolean;
  // Selected cards use plain header/content elements; list cards use the accordion components.
  plain?: boolean;
  onOverlayClick: (overlay: ProjectPanelOverlay) => Promise<boolean> | Promise<void>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "show-user-stats": [data: UserStatsPayload];
  "external-project-click": [];
}>();

const { imageErrors, handleImageError } = useImageErrors();
const isOsmImport = computed(() => props.project.importSource?.type === "osm");
const { entity: wikidataEntity } = useWikidataEntity(
  computed(() => props.project.externalProperties ?? null),
);
const pendingChangeCount = computed(() =>
  props.overlays.reduce(
    (count, overlay) => count + (props.overlayChangesMap.get(overlay.id)?.length ?? 0),
    props.projectChanges.length,
  ),
);

// OSM-imported projects have no on-site contributor and their updatedAt is just
// the import date, so the contributor line carries no meaning: hide it for them.
const contributorDate = computed(() =>
  props.project.importSource?.type === "osm" ? null : props.project.updatedAt,
);

const shouldShowImages = computed(
  () => props.overlays.length > 0 || Boolean(props.localRenderPreviewUrl),
);
async function handleCardClick() {
  if (props.plain) {
    emit("external-project-click");
    return;
  }
  const project = props.project;
  const originalGeometry = projectStore.hasProjectDraft(project.id)
    ? projectStore.getPersistedProject(project.id)?.geometry
    : null;
  const bounds = buildShapeBounds(project.geometry, originalGeometry);
  if (bounds) {
    mobileAwareFlyToBounds(bounds);
    return;
  }
  const firstOverlay = props.overlays[0];
  if (firstOverlay && firstOverlay.status !== "rejected" && firstOverlay.status !== "replaced") {
    await props.onOverlayClick(firstOverlay);
  } else {
    handleProjectClick(project);
  }
}

function handleProjectClick(project: Project) {
  try {
    if (typeof project.lat !== "number" || typeof project.lng !== "number") {
      toastWarn(t("project.noLocation"), t("project.noLocation"));
      return;
    }
    navigateToProject(project.lat, project.lng, project.id);
  } catch (error) {
    console.error("Failed to navigate to project:", error);
    toastError(
      error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      t("overlay.navigationFailed"),
    );
  }
}

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
  overlay: ProjectPanelOverlay,
  data: { userId: string; username: string | null; reportCount: number },
) {
  handleContributorClick(data, overlay.authorApprovedCount, overlay.authorRejectedCount);
}

function getChangeRequestOverlay(overlay: ProjectPanelOverlay): Overlay | null {
  return overlay.kind ? (overlay as Overlay) : null;
}

async function handleOverlayCardClick(overlay: ProjectPanelOverlay) {
  if (overlay.kind === "render" || overlay.status === "rejected" || overlay.status === "replaced") {
    openOverlayImage(overlay);
    return;
  }

  await props.onOverlayClick(overlay);
}

function getOverlayChangeRequests(overlayId: string): PendingChangeRequest[] {
  return props.overlayChangesMap.get(overlayId) ?? [];
}

function getOverlayImageUrl(filename: string, status?: string | null): string {
  const forceBackendUrl = status !== "approved" && status !== "replaced";
  return buildThumbnailUrl(filename, forceBackendUrl);
}

const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");

function openOverlayImage(overlay: ProjectPanelOverlay): void {
  const fullImageUrl =
    overlay.imageUrl ||
    buildImageUrl(overlay.filename, overlay.status !== "approved" && overlay.status !== "replaced");
  lightbox.value?.open({
    url: fullImageUrl,
    header:
      overlay.caption || (overlay.kind === "render" ? t("render.label") : t("overlay.untitled")),
    crossorigin: imageRequiresCredentials(fullImageUrl) ? "use-credentials" : undefined,
  });
}

function openLocalRenderPreview(): void {
  if (!props.localRenderPreviewUrl) return;
  lightbox.value?.open({ url: props.localRenderPreviewUrl, header: t("render.label") });
}
</script>

<style scoped>
/* Mirror the AccordionHeader padding so the plain-card header lines up with accordion cards. */
.project-header-plain {
  display: block;
  padding: var(--p-accordion-header-padding, 1.125rem);
}

/* Mirror the .p-accordioncontent-content padding so the plain card matches accordion cards. */
.project-content-plain {
  display: block;
  padding: 0.5rem 0.5rem 0.5rem;
}
</style>
