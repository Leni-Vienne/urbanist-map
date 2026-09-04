import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";

export function useDetailPanel() {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();

  const detailVisible = computed(() => uiStore.mode === "view" && focusStore.detailVisible);

  const { activeTab } = storeToRefs(uiStore);

  return { detailVisible, activeTab };
}
