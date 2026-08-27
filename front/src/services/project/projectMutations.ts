import { useProjectStore } from "@/stores/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { createLocalProject, type LocalProjectInput } from "@/utils/typeFactories";

export function createProject(projectData: LocalProjectInput) {
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  const project = createLocalProject({
    ...projectData,
    ownerId: projectData.ownerId ?? authStore.user?.id ?? null,
  });

  projectStore.addLocalProject(project);

  return project.id;
}
