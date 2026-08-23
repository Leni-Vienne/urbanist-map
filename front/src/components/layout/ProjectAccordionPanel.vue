<template>
  <div :class="['relative h-full flex flex-col', panelClass]">
    <div
      v-if="title || $slots['header-actions']"
      class="sticky top-0 bg-content-hover-background flex items-center justify-between mb-2 px-4 pt-4 pb-3 z-10"
    >
      <h2 class="m-0 text-[1.1rem] font-semibold text-color tracking-tight whitespace-nowrap">
        {{ title }}
      </h2>
      <div v-if="$slots['header-actions']" class="flex items-center gap-3 w-full">
        <slot name="header-actions"></slot>
      </div>
    </div>

    <div
      ref="scrollAreaRef"
      class="flex-1 min-h-0 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
    >
      <div v-if="$slots['below-header']" class="px-4 pb-2 pr-3">
        <slot name="below-header"></slot>
      </div>

      <div
        v-if="selectedCard || projects.length > 0 || keepContentVisible || isLoading"
        ref="contentRef"
        class="flex flex-col gap-2 pb-2 pr-3"
      >
        <!-- Selected project: a plain, always-open card bound to the current map selection (own or
             external, in both edit and moderation). It appears when a project is selected and is
             dropped when the selection clears (e.g. a background-map click). The selected project is
             filtered out of the list below so it is never shown twice. The keyed Transition replays
             on every new selection so the swap is noticeable in peripheral vision. -->
        <Transition name="selected-card" mode="out-in">
          <div v-if="selectedCard" :key="selectedCard.id" class="mb-1">
            <div
              class="pl-3 pt-1 pb-0.5 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
            >
              {{ $t("contribute.selectedProject") }}
            </div>
            <div class="selected-project-card">
              <ProjectHeader
                plain
                :name="selectedCard.name ?? ''"
                :status="selectedCard.status"
                :pending-change-count="getPendingChangeCount(selectedCard)"
                :import-source-type="selectedCard.importSource?.type ?? null"
                :external-properties="selectedCard.externalProperties"
              />
              <ProjectContent
                plain
                :project="selectedCard"
                :project-changes="getProjectChangeRequestsForProject(selectedCard)"
                :overlay-changes-map="overlayChangesMap"
                :is-contribute-panel="isContributePanel"
                :show-user-stats-link="showUserStatsLink"
                hide-chevron
                :on-overlay-click="handleOverlayCardClick"
                @show-user-stats="(data) => emit('show-user-stats', data)"
                @project-click="emit('external-project-click')"
                @highlight-project="handleProjectHighlight"
                @remove-project-highlight="handleProjectUnhighlight"
                @highlight-overlay="highlightOverlayById"
                @remove-highlight="removeOverlayHighlight"
              >
                <template v-if="$slots['project-actions']" #project-actions="{ project: p }">
                  <slot
                    name="project-actions"
                    :project="p"
                    :is-external="selectedCardIsExternal"
                  ></slot>
                </template>
                <template v-if="$slots['change-actions']" #change-actions="{ change }">
                  <slot name="change-actions" :change="change"></slot>
                </template>
                <template
                  v-if="$slots['overlay-actions']"
                  #overlay-actions="{ overlay, project: p }"
                >
                  <slot name="overlay-actions" :overlay="overlay" :project="p"></slot>
                </template>
              </ProjectContent>
            </div>
          </div>
        </Transition>

        <!-- Single accordion for all flat-list panels -->
        <!-- @vue-expect-error PrimeVue v-model type mismatch -->
        <Accordion
          :multiple="true"
          :lazy="true"
          v-model:value="uiStore.activeAccordionPanels"
          class="city-accordion"
        >
          <template v-if="$slots['contributions-header']">
            <slot name="contributions-header"></slot>
          </template>
          <template v-else-if="listHeaderLabel && selectedCard && flatOrderedProjects.length > 0">
            <div
              class="pt-1 pb-0.5 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
            >
              {{ listHeaderLabel }}
            </div>
          </template>

          <!-- User contribution projects -->
          <AccordionPanel
            v-for="project in flatOrderedProjects"
            :key="project.id"
            :value="project.id"
          >
            <ProjectHeader
              :name="project.name ?? ''"
              :status="project.status"
              :pending-change-count="getPendingChangeCount(project)"
              :import-source-type="project.importSource?.type ?? null"
              :external-properties="project.externalProperties"
            />
            <ProjectContent
              :project="project"
              :project-changes="getProjectChangeRequestsForProject(project)"
              :overlay-changes-map="overlayChangesMap"
              :is-contribute-panel="isContributePanel"
              :show-user-stats-link="showUserStatsLink"
              :on-overlay-click="handleOverlayCardClick"
              @show-user-stats="(data) => emit('show-user-stats', data)"
              @project-click="handleCardClick"
              @highlight-project="handleProjectHighlight"
              @remove-project-highlight="handleProjectUnhighlight"
              @highlight-overlay="highlightOverlayById"
              @remove-highlight="removeOverlayHighlight"
            >
              <template #project-actions="{ project: p }">
                <slot
                  v-if="$slots['project-actions']"
                  name="project-actions"
                  :project="p"
                  :is-external="false"
                ></slot>
              </template>
              <template #change-actions="{ change }">
                <slot name="change-actions" :change="change"></slot>
              </template>
              <template #overlay-actions="{ overlay, project: p }">
                <slot
                  v-if="$slots['overlay-actions']"
                  name="overlay-actions"
                  :overlay="overlay"
                  :project="p"
                ></slot>
              </template>
            </ProjectContent>
          </AccordionPanel>
        </Accordion>

        <!-- Filter yields no matches, but contributions exist: keep controls above visible. While
             loading, stay quiet: the chrome above is mounted but the list isn't known yet. -->
        <PanelEmptyState
          v-if="flatOrderedProjects.length === 0 && !selectedCard && !isLoading"
          icon="folder"
          :message="emptyMessage"
          :sub-message="emptySubMessage"
        />
      </div>

      <!-- Empty state -->
      <PanelEmptyState
        v-else-if="!isLoading"
        icon="folder"
        :message="emptyMessage"
        :sub-message="emptySubMessage"
      >
        <template v-if="$slots['empty-state']">
          <slot name="empty-state"></slot>
        </template>
      </PanelEmptyState>

      <!-- Loading state -->
      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-(--p-text-color-secondary)"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ $t("overlay.loadingProjects") }}</p>
      </div>
    </div>

    <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { toastWarn, toastError } from "@/services/core/toast";

import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ProjectHeader from "@/components/project/ProjectHeader.vue";
import ProjectContent from "@/components/project/ProjectContent.vue";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";

import type {
  Project,
  ContributionProject,
  Overlay,
  PendingChangeRequest,
  UserStatsPayload,
} from "@/types/index";

import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { handleOverlayClickNavigation } from "@/services/overlay/clickHandler";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { navigateToProject } from "@/services/navigation/projectNavigation";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";

import { useScrollFade } from "@/composables/ui/useScrollFade";

interface Props {
  projects: ContributionProject[];
  isLoading: boolean;
  title?: string;
  panelClass?: string;
  emptyMessage?: string;
  emptySubMessage?: string;
  changeRequests?: PendingChangeRequest[];
  onOverlayClick?: (overlay: Overlay) => Promise<void>;
  // Enables "my contributions" behavior in change request sections (e.g. own-change wording).
  isContributePanel?: boolean;
  showUserStatsLink?: boolean;
  // Id of the map-selected project. When it matches a project in `projects`, that project is lifted
  // out of the list and shown in the "Selected project" card at the top.
  selectedProjectId?: string | null;
  // A selected project that is NOT in `projects` (e.g. someone else's project, or an approved project
  // outside the pending list). Shown in the same "Selected project" card as a read-only context entry.
  pinnedExternalProject?: ContributionProject | null;
  // Keep the content area mounted even when the (filtered) project list is empty, so a consumer
  // rendering its own filter controls via #contributions-header does not lose them on empty results.
  keepContentVisible?: boolean;
  // Divider label above the list, rendered only under a selected card and only without the
  // #contributions-header slot.
  listHeaderLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: "",
  panelClass: "",
  emptyMessage: "",
  emptySubMessage: "",
  changeRequests: () => [],
  onOverlayClick: undefined,
  isContributePanel: false,
  showUserStatsLink: false,
  selectedProjectId: null,
  pinnedExternalProject: null,
  keepContentVisible: false,
  listHeaderLabel: "",
});

const emit = defineEmits<{
  "show-user-stats": [data: UserStatsPayload];
  "external-project-click": [];
}>();

const { t } = useI18n();

const uiStore = useUiStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();

const { showScrollFade } = useScrollFade();

// The selected project as it appears in the list, if it is one of `projects`. Lifted into the card.
const selectedInListProject = computed(() =>
  props.selectedProjectId
    ? (props.projects.find((p) => p.id === props.selectedProjectId) ?? null)
    : null,
);

// The project shown in the "Selected project" card: the in-list match, or the external one supplied
// by the caller for selections that are not in `projects`.
const selectedCard = computed<ContributionProject | null>(
  () => selectedInListProject.value ?? props.pinnedExternalProject,
);

// External when it is not one of `projects` (read-only context: hide the delete/edit affordances).
const selectedCardIsExternal = computed(
  () => Boolean(selectedCard.value) && !selectedInListProject.value,
);

// The selected project is shown in the card above, so drop it from the list to avoid duplication.
const flatOrderedProjects = computed(() => {
  const selectedId = selectedCard.value?.id;
  return selectedId ? props.projects.filter((p) => p.id !== selectedId) : props.projects;
});

const projectChangesMap = computed(() => groupChangesByEntityId(props.changeRequests, "project"));

const overlayChangesMap = computed(() => groupChangesByEntityId(props.changeRequests, "overlay"));

function groupChangesByEntityId(
  requests: PendingChangeRequest[],
  entityType: PendingChangeRequest["entityType"],
): Map<string, PendingChangeRequest[]> {
  const map = new Map<string, PendingChangeRequest[]>();
  for (const req of requests) {
    if (req.entityType !== entityType) continue;
    let list = map.get(req.entityId);
    if (!list) {
      list = [];
      map.set(req.entityId, list);
    }
    list.push(req);
  }
  return map;
}

function getProjectChangeRequestsForProject(project: Project): PendingChangeRequest[] {
  if (project.status === "pending") {
    return [];
  }
  return projectChangesMap.value.get(project.id) || [];
}

function getPendingChangeCount(project: ContributionProject): number {
  let count = getProjectChangeRequestsForProject(project).length;
  for (const overlay of project.overlays) {
    count += overlayChangesMap.value.get(overlay.id)?.length ?? 0;
  }
  return count;
}

async function handleCardClick(project: ContributionProject) {
  const originalGeometry = project.isModified
    ? projectStore.getOriginalProject(project.id)?.geometry
    : null;
  const bounds = buildShapeBounds(project.geometry, originalGeometry);
  if (bounds) {
    mobileAwareFlyToBounds(bounds);
    return;
  }
  const firstOverlay = project.overlays[0];
  if (firstOverlay) {
    await handleOverlayCardClick(firstOverlay);
  } else {
    handleProjectClick(project);
  }
}

function handleProjectHighlight(project: Project) {
  focusStore.setHoverTarget({ kind: "project", projectId: project.id });
}

function handleProjectUnhighlight() {
  focusStore.setHoverTarget(null);
}

async function handleOverlayCardClick(overlay: Overlay) {
  if (props.onOverlayClick) {
    await props.onOverlayClick(overlay);
  } else {
    await handleOverlayClickNavigation(overlay);
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
</script>

<style scoped>
:deep(.city-accordion) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 0px 0px 12px;
}

:deep(.city-accordion .p-accordionheader) {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  background: transparent !important;
}

/* When open: header gets top-only rounding */
:deep(.city-accordion .p-accordionpanel-active .p-accordionheader) {
  border-radius: 12px 12px 0 0;
}

:deep(.city-accordion .p-accordionpanel) {
  border: 1px solid var(--p-content-border-color) !important;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--accordion-card-bg) !important;
}

:deep(.city-accordion .p-accordioncontent) {
  min-width: 0;
}

/* PrimeVue .p-accordioncontent-wrapper needs min-width:0 to prevent horizontal overflow */
:deep(.city-accordion .p-accordioncontent-wrapper) {
  min-width: 0;
  overflow: hidden;
}

:deep(.city-accordion .p-accordioncontent-content) {
  background: transparent !important;
  padding: 0.5rem 0.5rem 0.75rem;
  border-radius: 0 0 12px 12px;
}

/* Selected (external) project card: slide-in entrance, replayed on every new selection. */
.selected-card-enter-active {
  transition:
    opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.selected-card-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.selected-card-enter-from,
.selected-card-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Plain selection card: styled to match the accordion cards below, but with no collapse. The
   one-shot accent pulse (same primary color as the map highlight) links it to the clicked feature
   and replays on mount, i.e. on each new selection. */
.selected-project-card {
  margin-left: 12px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  background: var(--accordion-card-bg);
  overflow: hidden;
  animation: selected-project-pulse 1.3s ease-out;
}

@keyframes selected-project-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--p-primary-color) 50%, transparent);
    border-color: var(--p-primary-color);
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--p-primary-color) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>
