import type { Project, OverlayObject } from '@types';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useAuthStore } from '@stores/authStore';
import { createProjectObject } from '@utils/typeFactories';
import { storeToRefs } from 'pinia';

// AI : Export composable function that gets store refs when called (not at module level)
export function useProjects() {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const { overlays } = storeToRefs(overlayStore);
  const { projects, countries, selectedProjectId } = storeToRefs(projectStore);
  return { overlays, projects, countries, selectedProjectId };
}

export function createProject(projectData: Partial<Omit<Project, 'id' | 'overlayIds' | 'color'>>) {
  const authStore = useAuthStore();

  // AI : Use factory function for consistent object creation
  const project = createProjectObject({
    ...projectData,
    // AI : Set ownerId to current user if not provided
    ownerId: projectData.ownerId ?? authStore.user?.id ?? null
  });

  // AI : Create a new object reference to ensure shallowRef reactivity triggers
  const { projects } = useProjects();
  const updatedProjects = { ...projects.value };
  updatedProjects[project.id] = project;
  projects.value = updatedProjects;

  return project.id;
}

export function addOverlayToProjectWithId(projectId: string, overlayId: string): boolean {
  const { projects, overlays } = useProjects();

  if (projects.value[projectId] == null) {
    console.error('Project not found in memory store:', projectId);
    throw new Error('Project not found');
  }

  if (overlays.value[overlayId]  == null) {
    console.error('Overlay not found in memory store:', overlayId);
    throw new Error('Overlay not found');
  }

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

  // AI : Check if this is the first overlay being added to this project
  const isFirstOverlay = project.overlayIds.length === 0;

  // Update project with new overlay ID
  if (!project.overlayIds.includes(overlayId)) {
    project.overlayIds = [...project.overlayIds, overlayId];
  }

  // Update projects collection with the modified project
  updatedProjects[projectId] = project;
  projects.value = updatedProjects;

  // Update overlay with project reference
  const overlayObject = overlays.value[overlayId];
  overlayObject.projectId = projectId;

  // AI : Return whether this was the first overlay (caller can handle marker removal)
  return isFirstOverlay;
}

export function removeOverlayFromProjectWithId(projectId: string, overlayId: string) {
  const { projects, overlays } = useProjects();
  
  if (projects.value[projectId] != null) {
    console.error('Project not found:', projectId);
    throw new Error('Project not found');
  }

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

  // Filter out the overlay ID from the project's overlay IDs
  project.overlayIds = project.overlayIds.filter((id: string) => id !== overlayId);

  // Update projects collection with the modified project
  updatedProjects[projectId] = project;
  projects.value = updatedProjects;

  // Update overlay
  if (overlays.value[overlayId]) {
    const overlayObject = overlays.value[overlayId];
    overlayObject.projectId = ''; // Use empty string instead of undefined

    // Remove project styling
    removeProjectStyling(overlayObject);
  }
}

function removeProjectStyling(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const element = overlayObject.overlay.getElement();
  if (!element) return;

  // Remove all project styling using outline instead of individual borders
  element.style.outline = '';
  element.style.boxShadow = '';

  // Reset marker styling - only reset tooltip, no border or shadow
  if (overlayObject.marker) {
    // Reset tooltip
    overlayObject.marker.setTooltipContent('Overlay');
  }
}
