import type { Project } from "@/types/index";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { createProjectObject } from "@/utils/typeFactories";

export function createProject(projectData: Partial<Omit<Project, "id" | "overlayIds" | "color">>) {
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  // AI : Use factory function for consistent object creation
  const project = createProjectObject({
    ...projectData,
    // AI : Set ownerId to current user if not provided
    ownerId: projectData.ownerId ?? authStore.user?.id ?? null,
  });

  // AI : Create a new object reference to ensure shallowRef reactivity triggers
  const updatedProjects = { ...projectStore.projects };
  updatedProjects[project.id] = project;
  projectStore.projects = updatedProjects;

  return project.id;
}

export function addOverlayToProjectWithId(projectId: string, overlayId: string): boolean {
  const projectStore = useProjectStore();

  const existingProject = projectStore.projects[projectId];

  // AI : Project not in local store (e.g., came from backend contributions) - cannot update overlayIds
  if (!existingProject) {
    return false;
  }

  // AI : Capture before mutation to detect whether this is the first overlay
  const isFirstOverlay = existingProject.overlayIds.length === 0;

  if (!existingProject.overlayIds.includes(overlayId)) {
    const updatedProject = {
      ...existingProject,
      overlayIds: [...existingProject.overlayIds, overlayId],
    };
    projectStore.projects = { ...projectStore.projects, [projectId]: updatedProject };
  }

  return isFirstOverlay;
}
