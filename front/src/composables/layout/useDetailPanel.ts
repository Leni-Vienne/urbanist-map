import { computed } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";

export function useDetailPanel() {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();

  const detailVisible = computed(() => uiStore.mode === "view" && focusStore.detailVisible);

  return { detailVisible };
}
