import { computed } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useActiveDetail } from "@/composables/project/useActiveDetail";
import type { PanelTab } from "@/types";

/**
 * Shared panel state for the desktop SideMenu and the mobile MobileDrawer so the two can never
 * disagree about what to show.
 *
 * `detailVisible` drives the project/overlay detail slide-over, which only exists in view mode. Edit
 * (ContributePanel's pinned card) and moderation (ModerationPanel's accordion) both render the
 * selection inline in their own panel, so the slide-over would just cover that. Selecting still
 * drives map navigation, accordion scroll and marker highlight in those modes; only the covering
 * slide-over is suppressed.
 *
 * `activeTab` is a writable proxy onto the single source of truth in uiStore (mapStore.mode derives
 * from it), kept here so both menus bind the same v-model.
 */
export function useDetailPanel() {
  const uiStore = useUiStore();
  const mapStore = useMapStore();
  const activeDetail = useActiveDetail();

  const detailVisible = computed(() => mapStore.mode === "view" && activeDetail.visible.value);

  const activeTab = computed<PanelTab>({
    get: () => uiStore.activeTab,
    set: (value) => (uiStore.activeTab = value),
  });

  return { detailVisible, activeTab };
}
