<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Selected project/overlay detail, stacked above the list so the list stays browsable -->
    <div
      v-if="detailVisible"
      class="relative min-h-0 overflow-hidden border-b border-surface"
      :class="isMobile ? 'flex-1' : 'flex-none max-h-[65%]'"
    >
      <ProjectDetailPanel />
      <!-- One-shot accent ring linking the detail to the feature that was clicked. Keyed by the
           selected project so it remounts and replays the pulse on each new selection. -->
      <div
        v-if="selectedProjectId && !isMobile"
        :key="selectedProjectId"
        class="detail-pulse pointer-events-none absolute inset-0 z-10"
      ></div>
    </div>

    <!-- Visible-projects list region. Hidden on mobile while a detail is open so the detail gets
         the full panel height (no room to stack both on a small screen). -->
    <div v-if="!(isMobile && detailVisible)" class="flex-1 min-h-0">
      <PanelEmptyState v-if="!isReady" icon="map" :message="$t('overlay.loadingProjects')" />

      <PanelEmptyState
        v-else-if="projects.length === 0"
        icon="map-marker"
        :message="$t('onMap.noProjects')"
        :sub-message="$t('onMap.noProjectsDetail')"
      />

      <div v-else class="relative flex flex-col h-full min-h-0">
        <!-- Header with sort controls -->
        <div
          class="px-4 py-2.5 border-b border-surface bg-content-background flex items-center justify-between shrink-0"
        >
          <span class="text-sm text-muted-color">
            {{ $t("onMap.projectsVisible", { count: projects.length }, projects.length) }}
          </span>
          <div class="flex gap-1">
            <button
              v-for="btn in SORT_BUTTONS"
              :key="btn.mode"
              class="flex h-7 items-center gap-1 rounded px-2 text-sm transition-all duration-150"
              :class="
                sortMode === btn.mode
                  ? 'bg-primary-color text-white'
                  : 'text-muted-color hover:text-color hover:bg-content-hover-background'
              "
              @click="onSortClick(btn.mode)"
              v-tooltip.top="$t(btn.i18nKey)"
            >
              <i :class="btn.icon" class="text-xs"></i>
              <i
                v-if="sortMode === btn.mode"
                :class="sortReverse ? 'pi pi-arrow-up' : 'pi pi-arrow-down'"
                class="text-[0.6rem]"
              ></i>
            </button>
          </div>
        </div>

        <!-- Scrollable list -->
        <div
          ref="scrollAreaRef"
          class="flex-1 min-h-0 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          <div ref="contentRef">
            <!-- v-memo skips re-patching unchanged rows. Load-bearing: each v-tooltip below
                 unbinds and rebinds 4 listeners on every directive update, so without it a
                 full-list refresh churns ~8 listeners per row. -->
            <button
              v-for="project in projects"
              :key="project.id"
              :data-project-id="project.id"
              v-memo="[
                project.id,
                project.timelineStatus,
                project.name,
                project.firstTag,
                project.tags.length,
                project.id === selectedProjectId,
              ]"
              @click="navigateToProject(project)"
              @mouseenter="hoverProject(project.id)"
              @mouseleave="hoverProject(null)"
              class="project-row w-full flex items-center gap-3 px-4 py-3 border-none cursor-pointer transition-all duration-150 text-left border-b border-surface last:border-b-0 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10"
              :class="project.id === selectedProjectId ? 'is-selected' : 'bg-transparent'"
            >
              <LinePreview
                :status="project.timelineStatus"
                :color="tagColor(project.firstTag)"
                :title="$t(`timelineStatus.${project.timelineStatus}`, project.timelineStatus)"
              />

              <span
                class="flex-1 text-sm truncate"
                :class="project.name ? 'text-color font-medium' : 'text-muted-color italic'"
              >
                {{ project.name || $t("project.unnamed") }}
              </span>

              <span class="shrink-0 flex items-center gap-1">
                <span
                  v-if="project.firstTag"
                  class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full"
                  :style="tagChipStyle(project.firstTag)"
                >
                  {{
                    $te(`tags.${project.firstTag}`)
                      ? $t(`tags.${project.firstTag}`)
                      : project.firstTag
                  }}
                </span>
                <span
                  v-if="project.tags.length > 1"
                  class="text-[0.65rem] font-semibold text-muted-color"
                  :title="extraTagsTooltip(project.tags)"
                >
                  +{{ project.tags.length - 1 }}
                </span>
              </span>
            </button>
          </div>
        </div>

        <div v-if="isScrollable" class="scroll-fade-overlay"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useVisibleProjects, type SortMode } from "@/composables/project/useVisibleProjects";
import { useActiveDetailProjectId } from "@/composables/project/useActiveDetailProjectId";
import { PROJECT_TAG_MAP } from "@/config/projectTags";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import LinePreview from "@/components/common/LinePreview.vue";
import { useScrollFade } from "@/composables/ui/useScrollFade";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";

// Lazy loaded so the detail panel shares the same async chunk scope as PanelContent's copy.
const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const { t, te } = useI18n();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const { isMobile } = useIsMobile();

// A clicked overlay info popup or standalone project marker opens a detail, stacked above the list.
const detailVisible = computed(
  () => overlayStore.overlayDetailVisible || uiStore.projectDetail.visible,
);
const { projects, sortMode, sortReverse, isReady, navigateToProject, hoverProject } =
  useVisibleProjects();

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { isScrollable } = useScrollFade(scrollAreaRef, contentRef);

// The project whose detail is open, used to link the open detail to its row in the list.
const selectedProjectId = useActiveDetailProjectId();

/** Returns translated names of all tags after the first, joined by newlines. */
function extraTagsTooltip(tags: string[]): string {
  return tags
    .slice(1)
    .map((tag) => (te(`tags.${tag}`) ? t(`tags.${tag}`) : tag))
    .join("\n");
}

function onSortClick(mode: SortMode) {
  if (sortMode.value === mode) {
    sortReverse.value = !sortReverse.value;
  } else {
    sortMode.value = mode;
    sortReverse.value = false;
  }
}

const SORT_BUTTONS: { mode: SortMode; icon: string; i18nKey: string }[] = [
  { mode: "recent", icon: "pi pi-clock", i18nKey: "onMap.sortRecent" },
  { mode: "name", icon: "pi pi-sort-alpha-down", i18nKey: "onMap.sortName" },
  { mode: "size", icon: "pi pi-expand", i18nKey: "onMap.sortSize" },
  { mode: "status", icon: "pi pi-calendar", i18nKey: "onMap.sortStatus" },
];

const DEFAULT_TAG_COLOR = "#6b7280";

function tagColor(firstTag: string): string {
  return PROJECT_TAG_MAP.get(firstTag)?.color ?? DEFAULT_TAG_COLOR;
}

function tagChipStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: DEFAULT_TAG_COLOR, color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}
</script>

<style scoped>
/* Selected row: a steady primary left-accent + tint links the list entry to the open detail. */
.project-row.is-selected {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  box-shadow: inset 3px 0 0 0 var(--p-primary-color);
}

/* One-shot accent ring over the detail panel, same primary color as the map highlight, replayed on
   each new selection (the keyed wrapper remounts this). Inset so the panel's overflow clip keeps it. */
.detail-pulse {
  animation: detail-ring-pulse 1.3s ease-out;
}

@keyframes detail-ring-pulse {
  0% {
    box-shadow: inset 0 0 0 3px var(--p-primary-color);
    opacity: 1;
  }
  100% {
    box-shadow: inset 0 0 0 3px transparent;
    opacity: 0;
  }
}
</style>
