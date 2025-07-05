import {
  saveProject,
  getAllProjects,
  deleteProject,
  addOverlayToProject,
  removeOverlayFromProject,
} from '@composables/core/useDatabase';
import { overlays } from '@stores/overlayStore';
import { projects, selectedProjectId } from '@stores/projectStore';
import { useToast } from '@composables/ui/useToast';
import { trpc } from '@client';
import type { Project, OverlayObject } from '@types';

const toast = useToast();

// AI : Export the reactive stores from centralized location
export { projects, selectedProjectId };

// AI : Get projects with overlays near the camera center (within 10km by default)
export async function loadProjectsNearLocation(lat: number, lng: number, radiusKm: number = 10): Promise<void> {
  try {
    // AI : Fetch projects from backend that have overlays near the location
    let nearbyProjects: Project[] = [];
    try {
      const backendResult = await trpc.project.getProjectsNearLocation.query({
        lat,
        lng,
        radiusKm
      });

      nearbyProjects = backendResult.projects.map(backendProject => {
        // AI : Cast metadata to the expected structure
        const metadata = backendProject.metadata as {
          location?: string;
          startDate?: string;
          endDate?: string;
          sourceUrl?: string;
          overlayIds?: string[];
          color?: string;
          createdAt?: string;
          updatedAt?: string;
        } | null;
        return {
          id: backendProject.id,
          name: backendProject.title,
          description: backendProject.description ?? '',
          color: metadata?.color ?? '#007bff',
          location: metadata?.location ?? '',
          cityId: backendProject.cityId ?? undefined, // AI : Include cityId from backend
          city: backendProject.city ?? undefined, // AI : Include full city object from backend
          startDate: metadata?.startDate ? new Date(metadata.startDate) : null,
          endDate: metadata?.endDate ? new Date(metadata.endDate) : null,
          sourceUrl: metadata?.sourceUrl ?? '',
          overlayIds: metadata?.overlayIds ?? [],
          createdAt: backendProject.createdAt?.toISOString() ?? new Date().toISOString(),
          updatedAt: backendProject.updatedAt?.toISOString() ?? new Date().toISOString()
        };
      });
    } catch (error) {
      console.warn('AI : Could not fetch nearby projects from backend:', error);
    }

    // AI : Get local project overrides/modifications
    const localProjects = await getAllProjects();
    // AI : Create projects map starting with existing projects to preserve city-loaded projects
    const projectsMap: Record<string, Project> = { ...projects.value };

    // AI : Add nearby backend projects (don't overwrite existing)
    nearbyProjects.forEach(project => {
      if (!projectsMap[project.id]) {
        projectsMap[project.id] = project;
      }
    });

    // AI : Override with local modifications (local takes precedence)
    localProjects.forEach(project => {
      projectsMap[project.id] = project;
    });
    projects.value = projectsMap;
  } catch (error) {
    console.error('Error loading nearby projects:', error);
    // Keep existing projects on error
  }
}

export async function createProject(projectData: Omit<Project, 'id' | 'overlayIds' | 'color'>): Promise<string> {
  const id = crypto.randomUUID();

  const project: Project = {
    ...projectData,
    id,
    overlayIds: [],
    color: '#007bff',
  };

  await saveProject(project);

  // AI : Create a new object reference to ensure shallowRef reactivity triggers
  const updatedProjects = { ...projects.value };
  updatedProjects[id] = project;
  projects.value = updatedProjects;

  return id;
}

export async function getOverlaysForProject(projectId: string): Promise<OverlayObject[]> {
  const project = projects.value[projectId];
  if (!project) return [];

  const projectOverlays: OverlayObject[] = [];

  for (const overlayId of project.overlayIds) {
    if (overlays.value[overlayId]) {
      // AI : Ensure we're pushing a proper OverlayObject with all expected properties
      projectOverlays.push(overlays.value[overlayId]);
    }
  }

  return projectOverlays;
}

export async function addOverlayToProjectWithId(projectId: string, overlayId: string): Promise<void> {
  if (!projects.value[projectId]) {
    console.error('AI : Project not found in memory store:', projectId);
    toast.add({
      severity: 'error',
      summary: 'Project not found',
      detail: 'The selected project could not be found',
      life: 3000
    });
    return;
  }

  if (!overlays.value[overlayId]) {
    console.error('AI : Overlay not found in memory store:', overlayId);
    toast.add({
      severity: 'error',
      summary: 'Overlay not found',
      detail: 'The selected overlay could not be found',
      life: 3000
    });
    return;
  }

  // Update database
  await addOverlayToProject(projectId, overlayId);

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

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

  toast.add({
    severity: 'success',
    summary: 'Overlay added to project',
    detail: `Overlay has been added to project "${project.name}"`,
    life: 3000
  });
}

export async function removeOverlayFromProjectWithId(projectId: string, overlayId: string): Promise<void> {
  if (!projects.value[projectId]) {
    console.error('Project not found:', projectId);
    return;
  }

  // Update database
  await removeOverlayFromProject(projectId, overlayId);

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

  // Filter out the overlay ID from the project's overlay IDs
  project.overlayIds = project.overlayIds.filter(id => id !== overlayId);

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

  toast.add({
    severity: 'info',
    summary: 'Overlay removed from project',
    detail: `Overlay has been removed from project "${project.name}"`,
    life: 3000
  });
}

export function removeProjectStyling(overlayObject: OverlayObject): void {
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

export function highlightProjectOverlays(projectId: string): void {
  const project = projects.value[projectId];
  if (!project) return;

  for (const overlayId of project.overlayIds) {
    const overlayObject = overlays.value[overlayId];
    if (!overlayObject?.overlay) continue;

    const element = overlayObject.overlay.getElement();
    if (element) {
      // Set CSS variable for the project color to use in animation
      element.style.setProperty('--project-color', `${project.color}80`); // 80 = 50% opacity
      // Highlight with a pulsing effect
      element.style.animation = 'pulse 1.5s infinite';
    }
  }
}

export function clearProjectHighlight(projectId: string): void {
  const project = projects.value[projectId];
  if (!project) return;

  for (const overlayId of project.overlayIds) {
    const overlayObject = overlays.value[overlayId];
    if (!overlayObject?.overlay) continue;

    const element = overlayObject.overlay.getElement();
    if (element) {
      element.style.animation = '';
    }
  }
}

export async function deleteProjectById(projectId: string): Promise<void> {
  const project = projects.value[projectId];
  if (!project) {
    console.error('Project not found:', projectId);
    return;
  }

  // Remove project reference from all its overlays
  for (const overlayId of project.overlayIds) {
    const overlayObject = overlays.value[overlayId];
    if (overlayObject) {
      overlayObject.projectId = ''; // Set to empty string instead of undefined
      removeProjectStyling(overlayObject);
    }
  }

  // Delete from database
  await deleteProject(projectId);

  // Create a new object for projects.value to trigger reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  delete updatedProjects[projectId];
  projects.value = updatedProjects;

  // Clear selection if this was the selected project
  if (selectedProjectId.value === projectId) {
    selectedProjectId.value = null;
  }

  toast.add({
    severity: 'info',
    summary: 'Project deleted',
    detail: `Project "${project.name}" has been deleted`,
    life: 3000
  });
}

export async function updateProject(projectId: string, projectData: Partial<Omit<Project, 'id' | 'overlayIds' | 'color'>>): Promise<void> {
  const project = projects.value[projectId];
  if (!project) {
    toast.add({
      severity: 'error',
      summary: 'Project not found',
      detail: 'The project to update could not be found',
      life: 3000
    });
    return;
  }

  // AI : Create new project object with updated fields
  const updatedProject = { ...project, ...projectData };

  // Save to database
  await saveProject(updatedProject);

  // AI : Create a new projects object reference to trigger shallowRef reactivity
  const updatedProjects = { ...projects.value };
  updatedProjects[projectId] = updatedProject;
  projects.value = updatedProjects;
}