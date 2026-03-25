<template>
  <div :class="['h-full flex flex-col', panelClass]">
    <div
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
      :class="[
        'flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        { 'scroll-area': isScrollable },
      ]"
    >
      <div
        v-if="projects.length > 0 || pinnedExternalProject"
        ref="contentRef"
        class="flex flex-col gap-2 pb-2 pr-3"
      >
        <!-- Flat list (no grouping): preserves input order with optional pinned project at top -->
        <template v-if="disableGrouping">
          <!-- Section label: external selected project or pinned own contribution -->
          <div
            v-if="pinnedExternalProject"
            class="-mr-3 px-4 py-2 bg-[color-mix(in_srgb,var(--p-primary-color)_8%,var(--p-content-background))] border-b border-primary-200 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
          >
            {{ $t("contribute.selectedProject") }}
          </div>
          <div
            v-else-if="pinnedProject"
            class="-mr-3 px-4 py-2 bg-[color-mix(in_srgb,var(--p-primary-color)_8%,var(--p-content-background))] border-b border-primary-200 text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
          >
            {{ $t("contribute.selectedProject") }}
          </div>

          <!-- Single accordion for all flat-list panels -->
          <Accordion
            :multiple="true"
            :lazy="true"
            v-model:value="activeAccordionPanels"
            class="city-accordion"
          >
            <!-- External pinned project (selected on map, not in user contributions) -->
            <AccordionPanel
              v-if="pinnedExternalProject"
              :key="pinnedExternalProject.id"
              :value="pinnedExternalProject.id"
              :data-project-id="pinnedExternalProject.id"
            >
              <ProjectHeader
                :name="pinnedExternalProject.name ?? ''"
                :status="pinnedExternalProject.status"
                :hide-status-badges="hideStatusBadges"
              />
              <ProjectContent
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
                <template
                  v-if="$slots['pinned-external-project-actions']"
                  #project-actions="{ project: p }"
                >
                  <slot name="pinned-external-project-actions" :project="p"></slot>
                </template>
              </ProjectContent>
            </AccordionPanel>

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
                :role="projectRoles?.[project.id] ?? null"
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
                  <slot v-if="$slots['project-actions']" name="project-actions" :project="p"></slot>
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
        </template>

        <!-- Grouped list (country / city hierarchy) -->
        <template v-else>
          <template v-for="countryGroup in groupedByCountry" :key="countryGroup.countryCode">
            <!-- Country header -->
            <div
              class="-mr-3 py-3.5 px-4 bg-[color-mix(in_srgb,var(--p-primary-color)_8%,var(--p-content-background))] border-b-2 border-primary-200 cursor-pointer transition-colors duration-150 select-none hover:bg-[color-mix(in_srgb,var(--p-primary-color)_14%,var(--p-content-background))]"
              @click="handleToggleCountryExpanded(countryGroup.countryCode)"
            >
              <div class="flex items-center gap-3">
                <i
                  :class="[
                    'pi text-primary-600 text-xs transition-transform',
                    isCountryExpanded(countryGroup.countryCode)
                      ? 'pi-chevron-down'
                      : 'pi-chevron-right',
                  ]"
                ></i>
                <h3 class="m-0 text-base font-bold text-color flex-1 flex items-center gap-1.5">
                  {{ countryGroup.countryName }}
                  <span class="text-[0.8125rem] font-semibold text-muted-color"
                    >({{ countryGroup.countryCode }})</span
                  >
                </h3>
                <span
                  class="text-[0.8125rem] font-bold text-primary-color bg-[color-mix(in_srgb,var(--p-primary-color)_15%,transparent)] px-2.5 py-1 rounded-xl min-w-7 text-center"
                  >{{ countryGroup.totalProjects }}</span
                >
              </div>
            </div>

            <!-- Country content -->
            <div v-if="shouldShowCountryContent(countryGroup.countryCode)">
              <template v-for="cityGroup in countryGroup.cities" :key="cityGroup.key">
                <!-- City header -->
                <div
                  class="flex items-center justify-between py-2.5 px-3.5 mt-3 mb-2 first:mt-1 bg-content-hover-background border-l-[3px] border-l-content-border-color rounded cursor-pointer transition-colors duration-150 select-none hover:bg-content-hover-background hover:brightness-95 dark:hover:brightness-110"
                  :data-city-key="cityGroup.key"
                  @click="toggleCityExpanded(cityGroup.key)"
                >
                  <div class="flex items-center gap-2">
                    <i
                      :class="[
                        'pi text-muted-color text-2.5 transition-transform',
                        isCityExpanded(cityGroup.key) ? 'pi-chevron-down' : 'pi-chevron-right',
                      ]"
                    ></i>
                    <h4 class="m-0 text-[0.8125rem] font-semibold text-color">
                      {{ cityGroup.cityName }}
                      <span
                        v-if="cityGroup.cityNameLocal"
                        class="text-xs font-medium text-muted-color ml-1"
                        >({{ cityGroup.cityNameLocal }})</span
                      >
                    </h4>
                  </div>
                  <span
                    class="text-[0.6875rem] font-semibold text-(--p-text-color-secondary) bg-content-hover-background border border-surface px-2 py-0.5 rounded-xl min-w-5 text-center"
                    >{{ cityGroup.projects.length }}</span
                  >
                </div>

                <!-- City accordion -->
                <Accordion
                  v-if="shouldShowCityContent(cityGroup.key)"
                  :multiple="true"
                  :lazy="true"
                  v-model:value="activeAccordionPanels"
                  class="city-accordion"
                >
                  <AccordionPanel
                    v-for="project in cityGroup.projects"
                    :key="project.id"
                    :value="project.id"
                    :data-project-id="project.id"
                  >
                    <ProjectHeader
                      :name="project.name ?? ''"
                      :status="project.status"
                      :hide-status-badges="hideStatusBadges"
                      :role="projectRoles?.[project.id] ?? null"
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
              </template>
            </div>
          </template>
        </template>
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
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  watch,
  nextTick,
  onMounted,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  ref,
} from "vue";
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

// Composables
import {
  activeAccordionPanels,
  toggleCountryExpanded,
  isCountryExpanded,
  toggleCityExpanded,
  isCityExpanded,
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
} from "@/services/map/shapeRendering";
import {
  highlightStandaloneProjectMarker,
  unhighlightStandaloneProjectMarker,
} from "@/services/map/standaloneProjectMarkers";
import { navigateToStandaloneProject } from "@/services/navigation/projectNavigation";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/overlaySelection";
import { useToast } from "@/composables/ui/useToast";
import { useMapStore } from "@/stores/pinia/mapStore";

// Props interface
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
  disableGrouping?: boolean;
  showEditButtons?: boolean;
  shouldSwitchToEditMode?: boolean;
  pinnedProjectId?: string | null;
  projectRoles?: Record<string, "created" | "contributed">;
  pinnedExternalProject?: ProjectForModeration | null;
}

interface CityGroup {
  key: string;
  cityName: string;
  cityNameLocal: string | null;
  projects: ProjectForModeration[];
}

interface CountryGroup {
  countryCode: string;
  countryName: string;
  totalProjects: number;
  cities: CityGroup[];
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: "",
  emptySubMessage: "",
  changeRequests: () => [],
  showUserStatsLink: false,
  hideStatusBadges: false,
  disableAutoModeSwitch: false,
  disableGrouping: false,
  showEditButtons: false,
  shouldSwitchToEditMode: false,
  pinnedProjectId: null,
  projectRoles: () => ({}),
  pinnedExternalProject: null,
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
const isScrollable = ref(false);

function updateScrollable() {
  const el = scrollAreaRef.value;
  if (el) {
    isScrollable.value = el.scrollHeight > el.clientHeight;
  }
}

// We observe two elements so updateScrollable fires on both:
// - scrollAreaRef: clientHeight changes when the panel is resized
// - contentRef: scrollHeight changes as accordions animate or groups expand/collapse
const scrollObserver = new ResizeObserver(updateScrollable);

onMounted(() => {
  if (scrollAreaRef.value) scrollObserver.observe(scrollAreaRef.value);
  updateScrollable();
});

onActivated(updateScrollable);

onBeforeUnmount(() => scrollObserver.disconnect());

watch(contentRef, (el, oldEl) => {
  if (oldEl) scrollObserver.unobserve(oldEl);
  if (el) {
    scrollObserver.observe(el);
    updateScrollable();
  } else {
    isScrollable.value = false;
  }
});

// Watch for new scroll requests (handled reactively)
// This ensures requests are handled even if projects data matches and doesn't trigger the above watcher
watch(
  () => pendingScrollRequest.value,
  async (newRequest) => {
    if (newRequest && props.projects.length > 0) {
      await handleScrollRequest();
    }
  },
);

const isContributePanel = computed(() => props.panelClass === "my-contributions-panel");

const groupedByCountry = computed(() => {
  const countryMap = new Map<string, CountryGroup>();

  for (const project of props.projects) {
    const countryName = project.countryName ?? "Unknown Country";
    const cityName = project.cityName ?? "Unknown City";
    const countryCode = project.countryCode ?? "unknown";

    if (!countryMap.has(countryCode)) {
      countryMap.set(countryCode, {
        countryCode,
        countryName,
        totalProjects: 0,
        cities: [],
      });
    }

    const country = countryMap.get(countryCode);
    if (!country) continue;

    country.totalProjects += 1;

    let cityGroup = country.cities.find((c) => c.cityName === cityName);
    if (!cityGroup) {
      const cityNameLocal = project.city?.nameLocal ?? null;
      cityGroup = {
        key: `${countryCode}-${cityName}`,
        cityName,
        cityNameLocal,
        projects: [],
      };
      country.cities.push(cityGroup);
    }

    cityGroup.projects.push(project);
  }

  const sorted = [...countryMap.values()].toSorted((a, b) =>
    a.countryName.localeCompare(b.countryName),
  );

  for (const country of sorted) {
    country.cities.sort((a, b) => a.cityName.localeCompare(b.cityName));
  }

  return sorted;
});

// When grouping is disabled, preserve input order (updatedAt desc from backend) instead of alphabetical
const flatOrderedProjects = computed(() => {
  if (!props.disableGrouping) return [];
  if (!props.pinnedProjectId) return props.projects;
  const pinned = props.projects.find((p) => p.id === props.pinnedProjectId);
  const rest = props.projects.filter((p) => p.id !== props.pinnedProjectId);
  return pinned ? [pinned, ...rest] : props.projects;
});

const pinnedProject = computed(() =>
  props.disableGrouping && props.pinnedProjectId
    ? (props.projects.find((p) => p.id === props.pinnedProjectId) ?? null)
    : null,
);

// Track if panel is active (visible) to prevent inactive panels from consuming scroll requests
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

// Watch for panel becoming active while a scroll request is pending
// This handles the race condition where requestScrollTo fires before the panel is active
// (e.g., tab switch from Latest to CurrentLocation via KeepAlive or async component mount)
watch(
  () => isPanelActive.value,
  async (active) => {
    if (active && pendingScrollRequest.value && props.projects.length > 0) {
      await nextTick();
      await handleScrollRequest();
    }
  },
);

function handleToggleCountryExpanded(countryCode: string) {
  const country = groupedByCountry.value.find((c) => c.countryCode === countryCode);
  toggleCountryExpanded(countryCode, country);
}

function shouldShowCountryContent(countryCode: string): boolean {
  return props.disableGrouping || isCountryExpanded(countryCode);
}

function shouldShowCityContent(cityKey: string): boolean {
  return props.disableGrouping || isCityExpanded(cityKey);
}

// Handle scroll requests
async function handleScrollRequest() {
  // Only active panels should consume requests
  if (!isPanelActive.value) {
    return;
  }

  // Peek at request without consuming it yet
  const request = pendingScrollRequest.value;
  if (!request) {
    return;
  }

  // Check if this panel can handle the request (contains the target)
  // This prevents the panel from consuming requests for items it doesn't have
  let canHandle = false;

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    // Efficient nested check using props.projects
    canHandle = props.projects.some(
      (p) => p.overlays && p.overlays.some((o) => o.id === overlayId),
    );
  } else if (request.type === "project") {
    const projectId = String(request.id);
    canHandle = props.projects.some((p) => p.id === projectId);
  } else if (request.type === "city") {
    const cityId = Number(request.id);
    canHandle = props.projects.some((p) => p.cityId === cityId);
  }

  if (!canHandle) {
    return;
  }

  // Now consume the request since we confirmed we can handle it
  consumeScrollRequest();

  await nextTick();

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    const wasExpanded = expandAccordionForOverlay(overlayId, props.projects);
    await nextTick();
    // Pass wasAlreadyExpanded: true if wasExpanded === false (it was already open)
    await waitForAccordionAnimation(overlayId, !wasExpanded);
  } else if (request.type === "project") {
    const projectId = String(request.id);
    const expanded = expandAccordionForProject(projectId, props.projects);
    if (expanded) {
      await nextTick();
      await waitForProjectAccordionAnimation(projectId);
    }
  } else if (request.type === "city") {
    const cityId = Number(request.id);
    let cityKey: string | null = null;
    let countryCode: string | null = null;

    for (const project of props.projects) {
      if (project.cityId === cityId) {
        countryCode = project.countryCode ?? "unknown";
        cityKey = `${countryCode}-${project.cityName}`;
        break;
      }
    }

    if (cityKey && countryCode) {
      if (!isCountryExpanded(countryCode)) {
        const country = groupedByCountry.value.find((c) => c.countryCode === countryCode);
        if (country) {
          toggleCountryExpanded(countryCode, country);
        }
      }

      if (!isCityExpanded(cityKey)) {
        toggleCityExpanded(cityKey);
      }

      await nextTick();
      await waitForCityAccordionAnimation(cityKey);
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

/**
 * Wait for accordion panel transition to complete before scrolling
 * Uses ResizeObserver to dynamically track accordion height changes and scroll in real-time
 */
async function scrollToOverlayWhenReady(
  element: Element,
  wasAlreadyExpanded: boolean = false,
): Promise<void> {
  // Find the project accordion panel that wraps this element
  const projectPanel = element.closest("[data-project-id]");

  if (!projectPanel) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    return;
  }

  // Store projectPanel in const to satisfy TypeScript null checking
  const panel = projectPanel;

  // If accordion was already expanded, just use smooth scroll immediately
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

  // Accordion is expanding, use ResizeObserver to track animation
  await new Promise<void>((resolve) => {
    let lastHeight = panel.clientHeight;
    let resizeCount = 0;
    const maxResizes = 20; // Safety limit to prevent infinite observation
    let timeoutId: NodeJS.Timeout | undefined = undefined;
    let fallbackTimeout: NodeJS.Timeout | undefined = undefined;

    // Function to perform the appropriate scroll based on context
    function performScroll(isAnimating: boolean) {
      const viewportHeight = window.innerHeight;
      const projectRect = panel.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const projectToElementDistance = elementRect.top - projectRect.top;

      // Use smooth scroll when accordion is already open (not animating)
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

        // Only scroll if height actually changed (accordion is expanding)
        if (newHeight !== lastHeight) {
          lastHeight = newHeight;
          resizeCount += 1;

          // Perform instant scroll during animation
          performScroll(true);

          // Reset timeout each time we detect a resize
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            clearTimeout(fallbackTimeout);
            observer.disconnect();
            resolve();
          }, 100);
        }

        // Safety check: disconnect after many resizes to prevent infinite loop
        if (resizeCount >= maxResizes) {
          clearTimeout(timeoutId);
          clearTimeout(fallbackTimeout);
          observer.disconnect();
          resolve();
        }
      }
    });

    // Start observing the accordion panel for size changes
    observer.observe(panel);

    // Fallback timeout in case ResizeObserver doesn't fire
    fallbackTimeout = setTimeout(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
      resolve();
    }, 1000);

    // If no resizes detected in 50ms, use smooth scroll
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

async function waitForCityAccordionAnimation(cityKey: string): Promise<void> {
  const cityElement = document.querySelector(`[data-city-key="${cityKey}"]`);
  if (!cityElement) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const element = document.querySelector(`[data-city-key="${cityKey}"]`);
      if (element) {
        await scrollToOverlayWhenReady(element);
        return;
      }
    }
    return;
  }
  await scrollToOverlayWhenReady(cityElement);
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

// Pre-compute project changes for O(1) lookup
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

// Pre-compute overlay changes for O(1) lookup
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

async function handleCardClick(project: ProjectForModeration) {
  if (hasProjectShapes(project.id)) {
    const bounds = getProjectShapeBounds(project.id);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
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
    if (!project.lat || !project.lng) {
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
    await navigateToStandaloneProject(
      project.lat,
      project.lng,
      project.cityId,
      project.cityName,
      project.countryCode ?? undefined,
      project.id,
    );
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
/* Gap entre panels + inset depuis les bords */
:deep(.city-accordion) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* DO NOT EVER CHANGE THE GAP AND PADDING */
  padding: 0 0px 0px 12px;
}

/* Header pleine largeur (all:unset supprime width + box-sizing natifs du button) */
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

/* Le panel est la "card" blanche sur fond gris */
:deep(.city-accordion .p-accordionpanel) {
  border: 1px solid var(--p-content-border-color) !important;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--accordion-card-bg) !important;
}

/* min-width:0 sur .p-accordioncontent (flex item dans le panel column) */
:deep(.city-accordion .p-accordioncontent) {
  min-width: 0;
}

/* Vrai coupable : .p-accordioncontent-wrapper est le grid item de .p-accordioncontent */
/* PrimeVue met min-height:0 mais pas min-width:0 → le grid item s'élargit à volonté */
:deep(.city-accordion .p-accordioncontent-wrapper) {
  min-width: 0;
  overflow: hidden;
}

/* Gradient fade en bas */
.scroll-area {
  mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
}

/* Contenu : fond transparent (hérité du panel) + padding contrôlé */
:deep(.city-accordion .p-accordioncontent-content) {
  background: transparent !important;
  padding: 0.5rem 0.5rem 0.75rem;
  border-radius: 0 0 12px 12px;
}
</style>
