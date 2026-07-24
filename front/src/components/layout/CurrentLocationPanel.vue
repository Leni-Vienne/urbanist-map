<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Visible-projects list. The selected project/overlay detail is a slide-over rendered by the
         host menu (SideMenu on desktop, MobileDrawer on mobile), independent of the active tab. -->
    <div class="flex-1 min-h-0">
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
              v-memo="[
                project.id,
                project.timelineStatus,
                project.name,
                project.firstTag,
                project.tags.length,
                project.id === selectedProjectId,
              ]"
              @click="navigateToProject(project)"
              @mouseenter="hoverProject(project)"
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

        <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useVisibleProjects, type SortMode } from "@/composables/project/useVisibleProjects";
import { useFocusStore } from "@/stores/focusStore";
import { PROJECT_TAG_MAP } from "@/constants/projectTags";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import LinePreview from "@/components/common/LinePreview.vue";
import { useScrollFade } from "@/composables/ui/useScrollFade";

const { t, te } = useI18n();
const { projects, sortMode, sortReverse, isReady, navigateToProject, hoverProject } =
  useVisibleProjects();

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

// The project whose detail is open, used to link the open detail to its row in the list.
const focusStore = useFocusStore();
const selectedProjectId = computed(() => focusStore.selectedProjectId);

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
</style>
