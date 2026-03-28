import { computed } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";

export function getCityProjects() {
  const projectStore = useProjectStore();
  const projects = computed(() => Object.values(projectStore.projects));
  return { projects };
}
