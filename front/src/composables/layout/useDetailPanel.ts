import { computed } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { PanelTab } from "@/types";

/**
 * Shared panel state for the desktop SideMenu and the mobile MobileDrawer so the two can never
 * disagree about what to show.
 *
 * `detailVisible` drives the project/overlay detail slide-over. In edit mode ContributePanel renders
 * the selection inline (its pinned ProjectMetadataCard), so the slide-over stays suppressed there to
 * avoid covering it.
 *
 * `activeTab` is a writable proxy onto the single source of truth in uiStore (mapStore.mode derives
 * from it), kept here so both menus bind the same v-model.
 */
export function useDetailPanel() {
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  const detailVisible = computed(
    () =>
      mapStore.mode !== "edit" &&
      (overlayStore.overlayDetailVisible || uiStore.projectDetail.visible),
  );

  const activeTab = computed<PanelTab>({
    get: () => uiStore.activeTab,
    set: (value) => (uiStore.activeTab = value),
  });

  return { detailVisible, activeTab };
}
