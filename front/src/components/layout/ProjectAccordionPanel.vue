<template>
  <div :class="panelClass">
    <div class="panel-content">
      <div class="panel-header">
        <h2 class="panel-title">{{ title }}</h2>
        <div v-if="$slots['header-actions']" class="header-actions">
          <slot name="header-actions"></slot>
        </div>
      </div>

      <div v-if="projects.length > 0" class="grouped-accordion-container">
        <template v-for="countryGroup in groupedByCountry" :key="countryGroup.countryCode">
          <div class="country-group">
            <!-- AI : Country header (hide if grouping disabled) -->
            <div
              v-if="!disableGrouping"
              class="country-group-header"
              @click="handleToggleCountryExpanded(countryGroup.countryCode)"
            >
              <div class="country-header-content">
                <i
                  :class="[
                    'pi',
                    isCountryExpanded(countryGroup.countryCode)
                      ? 'pi-chevron-down'
                      : 'pi-chevron-right',
                  ]"
                ></i>
                <h3 class="country-group-title">
                  {{ countryGroup.countryName }}
                  <span class="country-code-badge">({{ countryGroup.countryCode }})</span>
                </h3>
                <span class="country-group-count">{{ countryGroup.totalProjects }}</span>
              </div>
            </div>

            <!-- AI : Country content (always expanded if grouping disabled) -->
            <div v-if="shouldShowCountryContent(countryGroup.countryCode)" class="country-content">
              <template v-for="cityGroup in countryGroup.cities" :key="cityGroup.key">
                <!-- AI : City header (hide if grouping disabled) -->
                <div
                  v-if="!disableGrouping"
                  class="city-group-header"
                  :data-city-key="cityGroup.key"
                  @click="toggleCityExpanded(cityGroup.key)"
                >
                  <div class="city-header-content">
                    <i
                      :class="[
                        'pi',
                        isCityExpanded(cityGroup.key) ? 'pi-chevron-down' : 'pi-chevron-right',
                      ]"
                    ></i>
                    <h4 class="city-group-title">
                      {{ cityGroup.cityName }}
                      <span v-if="cityGroup.cityNameLocal" class="city-namelocal"
                        >({{ cityGroup.cityNameLocal }})</span
                      >
                    </h4>
                  </div>
                  <span class="city-group-count">{{ cityGroup.projects.length }}</span>
                </div>

                <!-- AI : City accordion (always expanded if grouping disabled) -->
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
                    <!-- AI : Extracted Project Header to isolate reactivity -->
                    <ProjectHeader
                      :name="project.name"
                      :status="project.status"
                      :hide-status-badges="hideStatusBadges"
                    />

                    <!-- AI : Extracted Project Content to isolate reactivity -->
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
          </div>
        </template>
      </div>

      <!-- AI : Empty state -->
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

      <!-- AI : Loading state -->
      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ $t("overlay.loadingProjects") }}</p>
      </div>
    </div>
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
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/overlaySelection";
import { useToast } from "@/composables/ui/useToast";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

// AI : Props interface
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
}>();

const { t } = useI18n();
const toast = useToast();

// AI : Watch for new scroll requests (handled reactively)
// AI : This ensures requests are handled even if projects data matches and doesn't trigger the above watcher
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

// AI : Track if panel is active (visible) to prevent inactive panels from consuming scroll requests
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

// AI : Handle scroll requests
async function handleScrollRequest() {
  // AI : Only active panels should consume requests
  if (!isPanelActive.value) {
    return;
  }

  // AI : Peek at request without consuming it yet
  const request = pendingScrollRequest.value;
  if (!request) {
    return;
  }

  // AI : Check if this panel can handle the request (contains the target)
  // AI : This prevents the panel from consuming requests for items it doesn't have
  let canHandle = false;

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    // AI : Efficient nested check using props.projects
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

  // AI : Now consume the request since we confirmed we can handle it
  consumeScrollRequest();

  await nextTick();

  if (request.type === "overlay") {
    const overlayId = String(request.id);
    const wasExpanded = expandAccordionForOverlay(overlayId, props.projects);
    await nextTick();
    // AI : Pass wasAlreadyExpanded: true if wasExpanded === false (it was already open)
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
 * AI : Wait for accordion panel transition to complete before scrolling
 * AI : Uses ResizeObserver to dynamically track accordion height changes and scroll in real-time
 */
async function scrollToOverlayWhenReady(
  element: Element,
  wasAlreadyExpanded: boolean = false,
): Promise<void> {
  // AI : Find the project accordion panel that wraps this element
  const projectPanel = element.closest("[data-project-id]");

  if (!projectPanel) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    return;
  }

  // AI : Store projectPanel in const to satisfy TypeScript null checking
  const panel = projectPanel;

  // AI : If accordion was already expanded, just use smooth scroll immediately
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

  // AI : Accordion is expanding, use ResizeObserver to track animation
  await new Promise<void>((resolve) => {
    let lastHeight = panel.clientHeight;
    let resizeCount = 0;
    const maxResizes = 20; // AI : Safety limit to prevent infinite observation
    let timeoutId: NodeJS.Timeout | undefined = undefined;
    let fallbackTimeout: NodeJS.Timeout | undefined = undefined;

    // AI : Function to perform the appropriate scroll based on context
    function performScroll(isAnimating: boolean) {
      const viewportHeight = window.innerHeight;
      const projectRect = panel.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const projectToElementDistance = elementRect.top - projectRect.top;

      // AI : Use smooth scroll when accordion is already open (not animating)
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

        // AI : Only scroll if height actually changed (accordion is expanding)
        if (newHeight !== lastHeight) {
          lastHeight = newHeight;
          resizeCount += 1;

          // AI : Perform instant scroll during animation
          performScroll(true);

          // AI : Reset timeout each time we detect a resize
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            clearTimeout(fallbackTimeout);
            observer.disconnect();
            resolve();
          }, 100);
        }

        // AI : Safety check: disconnect after many resizes to prevent infinite loop
        if (resizeCount >= maxResizes) {
          clearTimeout(timeoutId);
          clearTimeout(fallbackTimeout);
          observer.disconnect();
          resolve();
        }
      }
    });

    // AI : Start observing the accordion panel for size changes
    observer.observe(panel);

    // AI : Fallback timeout in case ResizeObserver doesn't fire
    fallbackTimeout = setTimeout(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
      resolve();
    }, 1000);

    // AI : If no resizes detected in 50ms, use smooth scroll
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
          const { useOverlayClickHandler } =
            await import("@/composables/overlay/useOverlayClickHandler");
          const { handleOverlayClickNavigation } = useOverlayClickHandler();
          await handleOverlayClickNavigation(overlay, true);
        }
        return;
      }
    }
  }
}

// AI : Pre-compute project changes for O(1) lookup
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

// AI : Pre-compute overlay changes for O(1) lookup
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

function handleCardClick(project: ProjectForModeration) {
  const hasOverlays = project.overlays && project.overlays.length > 0;
  if (hasOverlays) {
    // Use helper which might use custom prop or default
    // But here we need to call logic on an overlay.
    // We can just call navigate to first overlay
    if (project.overlays && project.overlays[0]) {
      handleOverlayCardClick(project.overlays[0]);
    }
  } else {
    handleStandaloneProjectClick(project);
  }
}

async function handleOverlayCardClick(overlay: OverlayForModeration) {
  if (props.onOverlayClick) {
    await props.onOverlayClick(overlay, true);
  } else {
    const { useOverlayClickHandler } = await import("@/composables/overlay/useOverlayClickHandler");
    const { handleOverlayClickNavigation } = useOverlayClickHandler();
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
    if (!project.cityId || !project.cityName) {
      toast.add({
        severity: "warn",
        summary: t("project.missingCityInfo"),
        detail: t("project.cannotNavigateWithoutCity"),
        life: 3000,
      });
      return;
    }
    const overlayStore = useOverlayStore();
    if (!props.disableAutoModeSwitch && overlayStore.mode !== "edit") {
      overlayStore.setMode("edit");
    }
    const { navigateToStandaloneProject } = await import("@/services/navigation/overlayNavigation");
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
/* AI : Grouped accordion container */
.grouped-accordion-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.country-group {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  overflow: hidden;
}

.country-group-header {
  padding: 0.875rem 1rem;
  background: var(--p-primary-50);
  border-bottom: 2px solid var(--p-primary-200);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.country-group-header:hover {
  background: var(--p-primary-100);
}

.country-header-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.country-header-content i {
  color: var(--p-primary-600);
  font-size: 0.75rem;
  transition: transform 0.2s ease;
}

.country-group-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-surface-900);
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.country-code-badge {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.country-group-count {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--p-primary-700);
  background: var(--p-primary-200);
  padding: 0.25rem 0.625rem;
  border-radius: 12px;
  min-width: 28px;
  text-align: center;
}

.city-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.875rem;
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-surface-100);
  border-left: 3px solid var(--p-surface-400);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.city-group-header:hover {
  background: var(--p-surface-200);
}

.city-group-header:first-child {
  margin-top: 0.25rem;
}

.city-header-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.city-header-content i {
  color: var(--p-surface-500);
  font-size: 0.625rem;
  transition: transform 0.2s ease;
}

.city-group-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.city-namelocal {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
  margin-left: 0.25rem;
}

.city-group-count {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--p-surface-600);
  background: var(--p-surface-200);
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  min-width: 20px;
  text-align: center;
}

/* AI : Component wrapper */
.my-contributions-panel,
.moderation-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
}

/* Sticky header for panel title  */
.panel-header {
  position: sticky;
  top: 0;
  background-color: var(--p-surface-0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  padding: 1rem 1rem 0.75rem 1rem;
  z-index: 10;
}

.panel-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--p-surface-900);
  letter-spacing: -0.025em;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}
</style>
