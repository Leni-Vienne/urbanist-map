import {
  saveProject,
  deleteProject,
} from '@composables/core/useDatabase';
import { overlays } from '@stores/overlayStore';
import { projects, selectedProjectId, countries } from '@stores/projectStore';
import { useToast } from '@composables/ui/useToast';
import { trpc } from '@client';
import type { Project, OverlayObject, StoredProjectData } from '@types';

const toast = useToast();

// AI : Helper functions to handle name/title mapping
// AI : These functions ensure backward compatibility while using Drizzle schema

/**
 * AI : Convert a Project object to StoredProjectData for database storage
 * Maps the 'name' field to 'title' for Drizzle schema compatibility
 */
function projectToStoredData(project: Project): StoredProjectData {
  const { name, overlayIds: _overlayIds, color: _color, ...drizzleData } = project;
  return {
    ...drizzleData,
    title: name, // AI : Map name to title for Drizzle schema
  };
}

/**
 * AI : Convert StoredProjectData from database to Project object
 * Maps the 'title' field to 'name' for backward compatibility
 */
export function storedDataToProject(storedData: StoredProjectData, overlayIds: string[] = [], color: string = '#007bff'): Project {
  return {
    ...storedData,
    name: storedData.title, // AI : Map title to name for backward compatibility
    overlayIds,
    color,
  };
}

// AI : Export the reactive stores from centralized location
export { projects, selectedProjectId, countries, projectToStoredData };

export async function loadCitiesForCountry(countryCode: string): Promise<void> {
  try {
    // AI : Get all cities that have projects for this specific country
    const citiesData = await trpc.cities.getCitiesWithProjects.query({ countryCode });

    const country = countries.value.find(c => {
      return c.code.trim() === countryCode.trim()
    });
    if (country) {
      country.cities = citiesData as any;
    }
  } catch (error) {
    console.error('Error loading cities for country:', error);
    throw error;
  }
}

export async function createProject(projectData: Partial<Omit<Project, 'id' | 'overlayIds' | 'color'>>): Promise<string> {
  const id = crypto.randomUUID();

  const project: Project = {
    ...projectData,
    id,
    overlayIds: [],
    color: '#007bff',
    // AI : Use title from Drizzle schema but populate from name for backward compatibility
    title: projectData.name || '',
    sourceUrl: projectData.sourceUrl || null,
    startDate: projectData.startDate || null,
    endDate: projectData.endDate || null,
    latestUpdateOn: projectData.latestUpdateOn || null,
    description: projectData.description || null,
    metadata: null,
    cityId: projectData.cityId || null,
    // AI : Add missing Drizzle fields with default values
    status: 'pending', // AI : Default status for new projects
    ownerId: null, // AI : No user authentication system yet
    createdAt: new Date(),
    updatedAt: new Date(),
    // AI : Add computed name property for backward compatibility
    name: projectData.name || '',
  };

  // AI : Convert to StoredProjectData and save to database
  const storedData = projectToStoredData(project);
  await saveProject(storedData);

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

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

  // Update project with new overlay ID
  if (!project.overlayIds.includes(overlayId)) {
    project.overlayIds = [...project.overlayIds, overlayId];
  }

  // AI : Convert to StoredProjectData and save to database
  const storedData = projectToStoredData(project);
  await saveProject(storedData);

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

  // AI : Create new references to ensure reactivity with shallowRef
  const updatedProjects = { ...projects.value };
  const project = { ...updatedProjects[projectId] };

  // Filter out the overlay ID from the project's overlay IDs
  project.overlayIds = project.overlayIds.filter(id => id !== overlayId);

  // AI : Convert to StoredProjectData and save to database
  const storedData = projectToStoredData(project);
  await saveProject(storedData);

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

  // AI : Convert to StoredProjectData and save to database
  const storedData = projectToStoredData(updatedProject);
  await saveProject(storedData);

  // AI : Create a new projects object reference to trigger shallowRef reactivity
  const updatedProjects = { ...projects.value };
  updatedProjects[projectId] = updatedProject;
  projects.value = updatedProjects;
}
