import type { Project } from "@/types/index";
import { useProjectStore } from "@/stores/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { createProjectObject } from "@/utils/typeFactories";

export function createProject(projectData: Partial<Omit<Project, "id" | "overlayIds" | "color">>) {
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  const project = createProjectObject({
    ...projectData,
    ownerId: projectData.ownerId ?? authStore.user?.id ?? null,
  });

  projectStore.projects[project.id] = project;

  return project.id;
}

export function addOverlayToProjectWithId(projectId: string, overlayId: string): boolean {
  const projectStore = useProjectStore();

  const existingProject = projectStore.projects[projectId];

  if (!existingProject) {
    return false;
  }

  const isFirstOverlay = existingProject.overlayIds.length === 0;

  if (!existingProject.overlayIds.includes(overlayId)) {
    existingProject.overlayIds.push(overlayId);
  }

  return isFirstOverlay;
}
