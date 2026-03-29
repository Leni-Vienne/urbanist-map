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
          <!-- Tag color dot -->
          <span
            class="shrink-0 w-2.5 h-2.5 rounded-full"
            :style="{ backgroundColor: tagColor(project.firstTag) }"
          ></span>

          <!-- Name -->
          <span
            class="flex-1 text-sm truncate"
            :class="project.name ? 'text-color font-medium' : 'text-muted-color italic'"
          >
            {{ project.name || $t("project.unnamed") }}
          </span>

          <!-- Status badge -->
          <span
            class="shrink-0 text-[0.7rem] font-semibold px-1.5 py-0.5 rounded"
            :style="statusStyle(project.timelineStatus)"
          >
            {{ $t(`timelineStatus.${project.timelineStatus}`, project.timelineStatus) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVisibleProjects, type SortMode } from "@/composables/project/useVisibleProjects";
import { PROJECT_TAG_MAP } from "@/config/projectTags";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import { useScrollFade } from "@/composables/ui/useScrollFade";

const { projects, sortMode, sortReverse, isReady, navigateToProject, hoverProject } =
  useVisibleProjects();

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

const DEFAULT_TAG_COLOR = "#3b82f6";

function tagColor(firstTag: string): string {
  return PROJECT_TAG_MAP.get(firstTag)?.color ?? DEFAULT_TAG_COLOR;
}

const STATUS_STYLES: Record<string, { backgroundColor: string; color: string }> = {
  proposed: { backgroundColor: "#fef9c3", color: "#854d0e" },
  planned: { backgroundColor: "#dbeafe", color: "#1e40af" },
  under_construction: { backgroundColor: "#ffedd5", color: "#9a3412" },
  completed: { backgroundColor: "#dcfce7", color: "#166534" },
  canceled: { backgroundColor: "#f3f4f6", color: "#4b5563" },
};

function statusStyle(status: string): Record<string, string> {
  return STATUS_STYLES[status] ?? STATUS_STYLES["proposed"]!;
}

const { isScrollable } = useScrollFade();
</script>

<style scoped>
.scroll-area {
  mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 48px), transparent 100%);
}
</style>
