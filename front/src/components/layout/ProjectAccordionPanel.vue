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
        v-if="projects.length > 0 || pinnedExternalProject || keepContentVisible"
        ref="contentRef"
        class="flex flex-col gap-2 pb-2 pr-3"
      >
        <!-- Selected (external) project: a plain card bound to the current map selection. It appears
             when a project is selected and is dropped when the selection clears (e.g. a background-map
             click). The keyed Transition replays on every new selection so the swap is noticeable in
             peripheral vision. -->
        <Transition name="selected-card" mode="out-in">
          <div v-if="pinnedExternalProject" :key="pinnedExternalProject.id" class="mb-1">
            <div
              class="pl-3 pt-1 pb-0.5 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
            >
              {{ $t("contribute.selectedProject") }}
            </div>
            <div class="selected-project-card" :data-project-id="pinnedExternalProject.id">
              <ProjectHeader
                plain
                :name="pinnedExternalProject.name ?? ''"
                :status="pinnedExternalProject.status"
                :hide-status-badges="hideStatusBadges"
                :import-source-type="pinnedExternalProject.importSource?.type ?? null"
                :external-properties="pinnedExternalProject.externalProperties"
              />
              <ProjectContent
                plain
                :project="pinnedExternalProject"
                :project-changes="[]"
                :all-change-requests="[]"
                :overlay-changes-map="new Map()"
                :projects-context="[pinnedExternalProject]"
                :is-contribute-panel="false"
                :show-user-stats-link="showUserStatsLink"
                :hide-status-badges="hideStatusBadges"
                :show-edit-buttons="false"
                :on-navigate-to-overlay="navigateToOverlayById"
                :on-overlay-click="onOverlayClick"
                @edit-project="handleStandaloneProjectClick"
                @project-click="(p) => emit('external-project-click', p)"
                @highlight-project="handleProjectHighlight"
                @remove-project-highlight="handleProjectUnhighlight"
                @highlight-overlay="highlightOverlayById"
                @remove-highlight="removeOverlayHighlight"
              >
                <template v-if="$slots['project-actions']" #project-actions="{ project: p }">
                  <slot name="project-actions" :project="p" :is-external="true"></slot>
                </template>
              </ProjectContent>
            </div>
          </div>
        </Transition>

        <!-- Single accordion for all flat-list panels -->
        <Accordion
          :multiple="true"
          :lazy="true"
          v-model:value="activeAccordionPanels"
          class="city-accordion"
        >
          <!-- "Your contributions" section header: custom controls (contribute panel) or plain divider -->
          <template v-if="$slots['contributions-header']">
            <slot name="contributions-header"></slot>
          </template>
          <template
            v-else-if="(pinnedExternalProject || pinnedProject) && flatOrderedProjects.length > 0"
          >
            <div
              class="pt-1 pb-0.5 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
            >
              {{ $t("contribute.yourContributions") }}
            </div>
          </template>

          <!-- User contribution projects -->
          <AccordionPanel
            v-for="project in flatOrderedProjects"
            :key="project.id"
            :value="project.id"
            :data-project-id="project.id"
          >
            <ProjectHeader
              :name="project.name ?? ''"
              :status="project.status"
              :hide-status-badges="hideStatusBadges"
              :pending-change-count="getPendingChangeCount(project)"
              :import-source-type="project.importSource?.type ?? null"
              :external-properties="project.externalProperties"
            />
            <ProjectContent
              :project="project"
              :project-changes="getProjectChangeRequestsForProject(project)"
              :all-change-requests="changeRequests"
              :overlay-changes-map="overlayChangesMap"
              :projects-context="projects"
              :is-contribute-panel="isContributePanel"
              :show-user-stats-link="showUserStatsLink"
              :hide-status-badges="hideStatusBadges"
              :show-edit-buttons="showEditButtons"
              :on-navigate-to-overlay="navigateToOverlayById"
              :on-overlay-click="onOverlayClick"
              @show-user-stats="(data) => emit('show-user-stats', data)"
              @edit-project="handleStandaloneProjectClick"
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

        <!-- Filter yields no matches, but contributions exist: keep controls above visible -->
        <PanelEmptyState
          v-if="flatOrderedProjects.length === 0 && !pinnedExternalProject"
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

    <div v-if="isScrollable" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onActivated, onDeactivated, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Accordion, AccordionPanel } from "primevue";
import ProjectHeader from "@/components/project/ProjectHeader.vue";
import ProjectContent from "@/components/project/ProjectContent.vue";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";

import type {
  ProjectForModeration,
  OverlayForModeration,
  PendingChangeRequest,
} from "@/types/index";

import {
  activeAccordionPanels,
  expandAccordionForOverlay,
  expandAccordionForProject,
  consumeScrollRequest,
  pendingScrollRequest,
} from "@/services/layout/accordionState";
import { useOverlayClickHandler } from "@/composables/overlay/useOverlayClickHandler";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import {
  getProjectShapeBounds,
  hasProjectShapes,
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeLayerRegistry";
import {
  highlightStandaloneProjectMarker,
  unhighlightStandaloneProjectMarker,
} from "@/services/map/standaloneProjectMarkers";
import { navigateToStandaloneProject } from "@/services/navigation/projectNavigation";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";
import { useToast } from "@/composables/ui/useToast";
import { useScrollFade } from "@/composables/ui/useScrollFade";
import { useMapStore } from "@/stores/pinia/mapStore";

interface Props {
  projects: ProjectForModeration[];
  isLoading: boolean;
  title: string;
  panelClass: string;
  emptyMessage?: string;
  emptySubMessage?: string;
  changeRequests?: PendingChangeRequest[];
  onOverlayClick?: (overlay: OverlayForModeration, shouldFitBounds: boolean) => Promise<void>;
  showUserStatsLink?: boolean;
  hideStatusBadges?: boolean;
  disableAutoModeSwitch?: boolean;
  showEditButtons?: boolean;
  pinnedProjectId?: string | null;
  pinnedExternalProject?: ProjectForModeration | null;
  // Keep the content area mounted even when the (filtered) project list is empty, so a consumer
  // rendering its own filter controls via #contributions-header does not lose them on empty results.
  keepContentVisible?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: "",
  emptySubMessage: "",
  changeRequests: () => [],
  showUserStatsLink: false,
  hideStatusBadges: false,
  disableAutoModeSwitch: false,
  showEditButtons: false,
  pinnedProjectId: null,
  pinnedExternalProject: null,
  keepContentVisible: false,
});

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
  "external-project-click": [project: ProjectForModeration];
}>();

const { t } = useI18n();
const toast = useToast();
const { handleOverlayClickNavigation } = useOverlayClickHandler();

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { isScrollable } = useScrollFade(scrollAreaRef, contentRef);

watch(
  () => pendingScrollRequest.value,
  async (newRequest) => {
    if (newRequest && props.projects.length > 0) {
      await handleScrollRequest();
    }
  },
);

const isContributePanel = computed(() => props.panelClass === "my-contributions-panel");

const flatOrderedProjects = computed(() => {
  if (!props.pinnedProjectId) return props.projects;
  const pinned = props.projects.find((p) => p.id === props.pinnedProjectId);
  const rest = props.projects.filter((p) => p.id !== props.pinnedProjectId);
  return pinned ? [pinned, ...rest] : props.projects;
});

const pinnedProject = computed(() =>
  props.pinnedProjectId
    ? (props.projects.find((p) => p.id === props.pinnedProjectId) ?? null)
    : null,
);

const isPanelActive = ref(false);

onMounted(() => {
  isPanelActive.value = true;
});

onActivated(() => {
  isPanelActive.value = true;
});

onDeactivated(() => {
  isPanelActive.value = false;
});

watch(
  () => isPanelActive.value,
  async (active) => {
    if (active && pendingScrollRequest.value && props.projects.length > 0) {
      await nextTick();
      await handleScrollRequest();
    }
  },
);

async function handleScrollRequest() {
  if (!isPanelActive.value) return;

  const request = pendingScrollRequest.value;
  if (!request) return;

  let canHandle = false;

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    canHandle = props.projects.some(
      (p) => p.overlays && p.overlays.some((o) => o.id === overlayId),
    );
  } else if (request.type === "project") {
    const projectId = String(request.id);
    canHandle = props.projects.some((p) => p.id === projectId);
  }

  if (!canHandle) return;

  consumeScrollRequest();
  await nextTick();

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    const wasExpanded = expandAccordionForOverlay(overlayId, props.projects);
    await nextTick();
    await waitForAccordionAnimation(overlayId, !wasExpanded);
  } else if (request.type === "project") {
    const projectId = String(request.id);
    const expanded = expandAccordionForProject(projectId, props.projects);
    if (expanded) {
      await nextTick();
      await waitForProjectAccordionAnimation(projectId);
    }
  }
}

watch(
  [() => props.projects, () => props.isLoading],
  async ([newProjects, newIsLoading]) => {
    if (newProjects.length > 0 && !newIsLoading) {
      await handleScrollRequest();
    }
  },
  { immediate: true },
);

async function waitForAccordionAnimation(
  overlayId: string,
  wasAlreadyExpanded: boolean = false,
): Promise<void> {
  const overlayElement = document.querySelector(`[data-overlay-id="${overlayId}"]`);

  if (!overlayElement) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const element = document.querySelector(`[data-overlay-id="${overlayId}"]`);
      if (element) {
        await scrollToOverlayWhenReady(element, wasAlreadyExpanded);
        return;
      }
    }
    return;
  }
  await scrollToOverlayWhenReady(overlayElement, wasAlreadyExpanded);
}

async function scrollToOverlayWhenReady(
  element: Element,
  wasAlreadyExpanded: boolean = false,
): Promise<void> {
  const projectPanel = element.closest("[data-project-id]");

  if (!projectPanel) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    return;
  }

  const panel = projectPanel;

  if (wasAlreadyExpanded) {
    const viewportHeight = window.innerHeight;
    const projectRect = panel.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const projectToElementDistance = elementRect.top - projectRect.top;

    if (projectToElementDistance < viewportHeight * 0.7) {
      panel.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    } else {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
    return;
  }

  await new Promise<void>((resolve) => {
    let lastHeight = panel.clientHeight;
    let resizeCount = 0;
    const maxResizes = 20;
    let timeoutId: NodeJS.Timeout | undefined = undefined;
    let fallbackTimeout: NodeJS.Timeout | undefined = undefined;

    function performScroll(isAnimating: boolean) {
      const viewportHeight = window.innerHeight;
      const projectRect = panel.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const projectToElementDistance = elementRect.top - projectRect.top;
      const scrollBehavior = isAnimating ? "auto" : "smooth";

      if (projectToElementDistance < viewportHeight * 0.7) {
        panel.scrollIntoView({
          behavior: scrollBehavior,
          block: "nearest",
          inline: "nearest",
        });
      } else {
        element.scrollIntoView({
          behavior: scrollBehavior,
          block: "center",
          inline: "nearest",
        });
      }
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight !== lastHeight) {
          lastHeight = newHeight;
          resizeCount += 1;
          performScroll(true);
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            clearTimeout(fallbackTimeout);
            observer.disconnect();
            resolve();
          }, 100);
        }
        if (resizeCount >= maxResizes) {
          clearTimeout(timeoutId);
          clearTimeout(fallbackTimeout);
          observer.disconnect();
          resolve();
        }
      }
    });

    observer.observe(panel);

    fallbackTimeout = setTimeout(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
      resolve();
    }, 1000);

    timeoutId = setTimeout(() => {
      if (resizeCount === 0) {
        performScroll(false);
      }
      clearTimeout(fallbackTimeout);
      observer.disconnect();
      resolve();
    }, 50);
  });
}

async function waitForProjectAccordionAnimation(projectId: string): Promise<void> {
  const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
  if (!projectElement) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const element = document.querySelector(`[data-project-id="${projectId}"]`);
      if (element) {
        await scrollToOverlayWhenReady(element);
        return;
      }
    }
    return;
  }
  await scrollToOverlayWhenReady(projectElement);
}

async function navigateToOverlayById(overlayId: string) {
  for (const project of props.projects) {
    if (project.overlays) {
      const overlay = project.overlays.find((o) => o.id === overlayId);
      if (overlay) {
        if (props.onOverlayClick) {
          await props.onOverlayClick(overlay, true);
        } else {
          await handleOverlayClickNavigation(overlay, true);
        }
        return;
      }
    }
  }
}

const projectChangesMap = computed(() => {
  const map = new Map<string, PendingChangeRequest[]>();
  for (const req of props.changeRequests) {
    if (req.entityType === "project") {
      let list = map.get(req.entityId);
      if (!list) {
        list = [];
        map.set(req.entityId, list);
      }
      list.push(req);
    }
  }
  return map;
});

const overlayChangesMap = computed(() => {
  const map = new Map<string, PendingChangeRequest[]>();
  for (const req of props.changeRequests) {
    if (req.entityType === "overlay") {
      let list = map.get(req.entityId);
      if (!list) {
        list = [];
        map.set(req.entityId, list);
      }
      list.push(req);
    }
  }
  return map;
});

function getProjectChangeRequestsForProject(project: ProjectForModeration): PendingChangeRequest[] {
  if (project.status === "pending") {
    return [];
  }
  return projectChangesMap.value.get(project.id) || [];
}

function getPendingChangeCount(project: ProjectForModeration): number {
  let count = getProjectChangeRequestsForProject(project).length;
  for (const overlay of project.overlays || []) {
    count += overlayChangesMap.value.get(overlay.id)?.length ?? 0;
  }
  return count;
}

async function handleCardClick(project: ProjectForModeration) {
  if (hasProjectShapes(project.id)) {
    const bounds = getProjectShapeBounds(project.id);
    if (bounds) {
      mobileAwareFlyToBounds(bounds);
      return;
    }
  }
  const hasOverlays = project.overlays && project.overlays.length > 0;
  if (hasOverlays) {
    if (project.overlays[0]) {
      handleOverlayCardClick(project.overlays[0]);
    }
  } else {
    handleStandaloneProjectClick(project);
  }
}

async function handleProjectHighlight(project: ProjectForModeration) {
  if (hasProjectShapes(project.id)) {
    highlightProjectShapes(project.id);
    return;
  }
  if (!project.overlays || project.overlays.length === 0) {
    highlightStandaloneProjectMarker(project.id);
  }
}

async function handleProjectUnhighlight(project: ProjectForModeration) {
  if (hasProjectShapes(project.id)) {
    unhighlightProjectShapes(project.id);
    return;
  }
  if (!project.overlays || project.overlays.length === 0) {
    unhighlightStandaloneProjectMarker(project.id);
  }
}

async function handleOverlayCardClick(overlay: OverlayForModeration) {
  if (props.onOverlayClick) {
    await props.onOverlayClick(overlay, true);
  } else {
    await handleOverlayClickNavigation(overlay, true);
  }
}

async function handleStandaloneProjectClick(project: ProjectForModeration) {
  try {
    if (typeof project.lat !== "number" || typeof project.lng !== "number") {
      toast.add({
        severity: "warn",
        summary: t("project.noLocation"),
        detail: t("project.noLocation"),
        life: 3000,
      });
      return;
    }
    const mapStore = useMapStore();
    if (!props.disableAutoModeSwitch && mapStore.mode !== "edit") {
      mapStore.setMode("edit");
    }
    navigateToStandaloneProject(project.lat, project.lng, project.id);
  } catch (error) {
    console.error("Failed to navigate to project:", error);
    toast.add({
      severity: "error",
      summary: t("overlay.navigationFailed"),
      detail: error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      life: 3000,
    });
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
