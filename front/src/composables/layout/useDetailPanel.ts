import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";

/**
 * Shared panel state for the desktop SideMenu and the mobile MobileDrawer so the two can never
 * disagree about what to show.
 *
 * `detailVisible` drives the docked project/overlay detail, which only exists in view mode. Edit
 * (ContributePanel's pinned card) and moderation (ModerationPanel's accordion) both render the
 * selection inline in their own panel, so the dock would only repeat it. Selecting still drives map
 * navigation, accordion scroll and marker highlight in those modes; only the dock is suppressed.
 *
 * `activeTab` is a writable proxy onto the single source of truth in uiStore, kept here so both
 * menus bind the same v-model. The map mode is derived from the same tab.
 */
export function useDetailPanel() {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();

  const detailVisible = computed(() => uiStore.mode === "view" && focusStore.detailVisible);

  const { activeTab } = storeToRefs(uiStore);

  return { detailVisible, activeTab };
}
