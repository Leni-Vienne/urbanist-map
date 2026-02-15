import type { Project } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
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
  const overlayStore = useOverlayStore();

  // AI : If project is not in memory store (e.g., came from backend user contributions),
  // AI : just update the overlay's projectId and skip the in-memory project update
  if (projectStore.projects[projectId] === null || projectStore.projects[projectId] === undefined) {
    // AI : Still update the overlay's projectId reference
    const overlayObject = overlayStore.overlays[overlayId];
    if (overlayObject) {
      overlayObject.projectId = projectId;
    }
    return false; // AI : Return false - we can't determine if it was first overlay
  }

  if (overlayStore.overlays[overlayId] === null || overlayStore.overlays[overlayId] === undefined) {
    console.error("Overlay not found in memory store:", overlayId);
    throw new Error("Overlay not found");
  }

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projectStore.projects };
  const project = { ...updatedProjects[projectId] };

  // AI : Ensure overlayIds array exists (defensive programming)
  project.overlayIds ??= [];

  // AI : Check if this is the first overlay being added to this project
  const isFirstOverlay = project.overlayIds.length === 0;

  // Update project with new overlay ID
  if (!project.overlayIds.includes(overlayId)) {
    project.overlayIds = [...project.overlayIds, overlayId];
  }

  // Update projects collection with the modified project
  updatedProjects[projectId] = project;
  projectStore.projects = updatedProjects;

  // Update overlay with project reference
  const overlayObject = overlayStore.overlays[overlayId];
  overlayObject.projectId = projectId;

  // AI : Return whether this was the first overlay (caller can handle marker removal)
  return isFirstOverlay;
}
