<template>
  <!-- Loading state: mlMap not ready yet -->
  <PanelEmptyState v-if="!isReady" icon="map" :message="$t('overlay.loadingProjects')" />

  <!-- Ready but empty -->
  <PanelEmptyState
    v-else-if="projects.length === 0"
    icon="map-marker"
    :message="$t('onMap.noProjects')"
    :sub-message="$t('onMap.noProjectsDetail')"
  />

  <!-- Project list -->
  <div v-else class="flex flex-col h-full min-h-0">
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
      :class="[
        'flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        { 'scroll-area': isScrollable },
      ]"
    >
      <div ref="contentRef">
        <button
          v-for="project in projects"
          :key="project.id"
          class="w-full flex items-center gap-3 px-4 py-3 border-none bg-transparent cursor-pointer transition-all duration-150 text-left border-b border-surface last:border-b-0 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10"
          @click="navigateToProject(project)"
          @mouseenter="hoverProject(project.id)"
          @mouseleave="hoverProject(null)"
        >
          <!-- Dashed line preview matching the map style for this project's status and tag color -->
          <svg
            width="28"
            height="10"
            class="shrink-0"
            v-tooltip.right="$t(`timelineStatus.${project.timelineStatus}`, project.timelineStatus)"
          >
            <line
              x1="0"
              y1="5"
              x2="28"
              y2="5"
              :stroke="tagColor(project.firstTag)"
              stroke-width="2.5"
              :stroke-dasharray="statusDasharray(project.timelineStatus)"
              stroke-linecap="round"
            />
          </svg>

          <!-- Name -->
          <span
            class="flex-1 text-sm truncate"
            :class="project.name ? 'text-color font-medium' : 'text-muted-color italic'"
          >
            {{ project.name || $t("project.unnamed") }}
          </span>

          <!-- Tag chips: first tag + overflow count -->
          <span class="shrink-0 flex items-center gap-1">
            <span
              v-if="project.firstTag"
              class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full"
              :style="tagChipStyle(project.firstTag)"
            >
              {{
                $te(`tags.${project.firstTag}`) ? $t(`tags.${project.firstTag}`) : project.firstTag
              }}
            </span>
            <span
              v-if="project.tags.length > 1"
              class="text-[0.65rem] font-semibold text-muted-color"
              v-tooltip.top="extraTagsTooltip(project.tags)"
            >
              +{{ project.tags.length - 1 }}
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useVisibleProjects, type SortMode } from "@/composables/project/useVisibleProjects";
import { PROJECT_TAG_MAP } from "@/config/projectTags";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import { useScrollFade } from "@/composables/ui/useScrollFade";

const { t, te } = useI18n();
const { projects, sortMode, sortReverse, isReady, navigateToProject, hoverProject } =
  useVisibleProjects();

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

// dasharray values mirror FilterControl's SVG line previews (same stroke-width 2.5px):
// proposed = short dash, planned/under_construction = long dash, completed = solid
const STATUS_DASHARRAY: Record<string, string> = {
  proposed: "3,4",
  planned: "7,4",
  under_construction: "7,4",
  completed: "",
  canceled: "7,4",
};

function statusDasharray(status: string): string {
  return STATUS_DASHARRAY[status] ?? "";
}

function tagChipStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: DEFAULT_TAG_COLOR, color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

const { isScrollable } = useScrollFade();
</script>

<style scoped>
.scroll-area {
  mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
}
</style>
