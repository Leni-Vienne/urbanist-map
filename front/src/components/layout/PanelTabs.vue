<template>
  <div
    class="flex bg-content-background border-b border-surface shrink-0"
    :class="{ 'overflow-x-auto': variant === 'mobile' }"
  >
    <template v-for="tab in TABS" :key="tab.labelKey">
      <button
        v-if="
          (!tab.mobileOnly || variant === 'mobile') &&
          (!tab.requiresModerator || authStore.isModerator)
        "
        type="button"
        :class="[
          'flex-1 py-2 text-sm border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-(--p-content-hover-background)',
          variant === 'desktop' ? 'first:pl-4 first:text-left' : 'min-[360px]:px-0.5',
          variant === 'desktop' && (authStore.isModerator ? 'px-0.5' : 'px-1'),
          variant === 'mobile' && authStore.isModerator && 'max-[389px]:text-xs',
          isSelected(tab)
            ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
            : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
        ]"
        :aria-current="isSelected(tab) ? 'true' : undefined"
        @click="selectTab(tab)"
      >
        {{ $t(tab.labelKey) }}
      </button>
    </template>

    <div v-if="variant === 'desktop'" class="relative inline-flex shrink-0 items-center px-1">
      <span
        v-if="showFilterDot"
        class="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background pointer-events-none z-10"
      />
      <Button
        icon="pi pi-sliders-h"
        :label="authStore.isModerator ? undefined : $t('navigation.filter')"
        size="small"
        severity="secondary"
        :aria-label="$t('navigation.filter')"
        v-tooltip.top="authStore.isModerator ? $t('navigation.filter') : undefined"
        @click="toggleFilterPopover"
      />
      <Popover ref="filterPopover" appendTo="body" :pt="{ root: { class: 'filter-popover' } }">
        <div
          class="min-w-55 max-w-75 overflow-y-auto overflow-x-hidden scroll-pt-9 pr-1"
          :style="{
            maxHeight: `calc(${filterPopoverHeight}px - 2 * var(--p-popover-content-padding) - 2px)`,
          }"
        >
          <FilterPanelContent />
        </div>
      </Popover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import type { PopoverMethods } from "primevue/popover";
import FilterPanelContent from "@/components/map/FilterPanelContent.vue";
import { activeFilters } from "@/services/core/filters";
import { filtersSeen } from "@/services/core/settings";
import type { PanelTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useLatestContributionsStore } from "@/stores/latestContributionsStore";

const authStore = useAuthStore();
const feedStore = useLatestContributionsStore();
const filterPopover = useTemplateRef<PopoverMethods>("filterPopover");
const filterPopoverHeight = ref(0);
const showFilterDot = computed(
  () => activeFilters.value.length > 0 || feedStore.mapArea !== null || !filtersSeen.value,
);

type Tab = {
  key: PanelTab;
  labelKey: string;
  includesOsm?: boolean;
  mobileOnly?: boolean;
  requiresModerator?: boolean;
};

const TABS: Tab[] = [
  { key: "explore", labelKey: "navigation.urbanistmap", includesOsm: false },
  { key: "explore", labelKey: "project.osmSource", includesOsm: true },
  { key: "filter", labelKey: "navigation.filter", mobileOnly: true },
  { key: "contribute", labelKey: "navigation.contribute" },
  { key: "moderation", labelKey: "moderation.title", requiresModerator: true },
];

const props = defineProps<{
  activeTab: PanelTab | null;
  variant?: "desktop" | "mobile";
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: PanelTab];
}>();

function isSelected(tab: Tab): boolean {
  return (
    props.activeTab === tab.key &&
    (tab.includesOsm === undefined || tab.includesOsm === feedStore.isOsmIncluded)
  );
}

function selectTab(tab: Tab): void {
  if (tab.includesOsm !== undefined) feedStore.isOsmIncluded = tab.includesOsm;
  emit("update:activeTab", tab.key);
}

function toggleFilterPopover(event: MouseEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const { top, bottom } = event.currentTarget.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const below = viewportHeight - bottom;
  const maxHeight = Math.min(600, viewportHeight * 0.7);
  const edgeClearance = 14; // 10px popover gutter and 4px viewport clearance.
  const aboveHeight = Math.min(maxHeight, top - edgeClearance);
  // PrimeVue flips only when the popover's box, excluding its gutter, cannot fit below.
  filterPopoverHeight.value =
    aboveHeight > below + 1 ? aboveHeight : Math.min(maxHeight, below - edgeClearance);
  filterPopover.value?.toggle(event);
}
</script>
