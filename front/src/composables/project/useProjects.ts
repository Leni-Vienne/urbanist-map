import type { Project, OverlayObject } from '@types';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
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
  const id = crypto.randomUUID();

  // AI : Filter out non-serializable properties from projectData (File objects, city objects)
  const { city: _city, sourcePdf: _sourcePdf, ...safeProjectData } = projectData;

  const project: Project = {
    ...safeProjectData,
    id,
    overlayIds: [],
    color: '#007bff',
    // AI : Use name from updated Drizzle schema
    name: safeProjectData.name ?? '',
    sourceUrl: safeProjectData.sourceUrl ?? null,
    startDate: safeProjectData.startDate ?? null,
    endDate: safeProjectData.endDate ?? null,
    latestUpdateOn: safeProjectData.latestUpdateOn ?? null,
    description: safeProjectData.description ?? null,
    metadata: null,
    cityId: safeProjectData.cityId ?? null,
    // AI : Add missing Drizzle fields with default values
    status: 'pending', // AI : Default status for new projects
    ownerId: null, // AI : No user authentication system yet
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // AI : Create a new object reference to ensure shallowRef reactivity triggers
  const { projects } = useProjects();
  const updatedProjects = { ...projects.value };
  updatedProjects[id] = project;
  projects.value = updatedProjects;

  return id;
}

export function addOverlayToProjectWithId(projectId: string, overlayId: string) {
  const { projects, overlays } = useProjects();
  
  if (!projects.value[projectId]) {
    console.error('AI : Project not found in memory store:', projectId);
    throw new Error('Project not found');
  }

  if (!overlays.value[overlayId]) {
    console.error('AI : Overlay not found in memory store:', overlayId);
    throw new Error('Overlay not found');
  }

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
}

export function removeOverlayFromProjectWithId(projectId: string, overlayId: string) {
  const { projects, overlays } = useProjects();
  
  if (!projects.value[projectId]) {
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
