import { ref, shallowRef } from 'vue';
import { 
  saveProject, 
  getAllProjects, 
  deleteProject, 
  addOverlayToProject, 
  removeOverlayFromProject,
} from './useDatabase';
import { overlays } from './useOverlay';
import { useToast } from './useToast';
import type { Project, OverlayObject } from '../types';

const toast = useToast();

// Store for all projects
export const projects = shallowRef<Record<string, Project>>({});
export const selectedProjectId = ref<string | null>(null);

// Generate a vibrant color for a project that will stand out
function generateRandomColor(): string {
  // Array of vibrant colors with good contrast
  const vibrantColors = [
    '#FF3D00', // Bright Red-Orange
    '#2979FF', // Bright Blue
    '#00C853', // Bright Green
    '#AA00FF', // Bright Purple
    '#FFAB00', // Amber
    '#00BFA5', // Teal
    '#D500F9', // Magenta
    '#FF9100', // Dark Orange
    '#1DE9B6', // Light Teal
    '#00B0FF', // Light Blue
    '#76FF03', // Lime
    '#FF4081', // Pink
    '#F50057', // Deep Pink
    '#651FFF', // Deep Purple
    '#FFD600'  // Yellow
  ];
  
  // Add randomness by slightly adjusting the color
  const baseColor = vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
  
  // For extra randomness, sometimes adjust the hue slightly
  if (Math.random() > 0.5) {
    return baseColor;
  }
  
  // Convert hex to HSL, adjust, then back to hex
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);
  
  // Add slight random variations to make it more unique
  const variation = Math.floor(Math.random() * 30) - 15; // -15 to +15
  
  // Ensure values stay within 0-255 range
  const newR = Math.min(255, Math.max(0, r + variation));
  const newG = Math.min(255, Math.max(0, g + variation));
  const newB = Math.min(255, Math.max(0, b + variation));
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

export async function initializeProjects(): Promise<void> {
  try {
    const projectList = await getAllProjects();
    const projectsMap: Record<string, Project> = {};
    
    projectList.forEach(project => {
      projectsMap[project.id] = project;
    });
    
    projects.value = projectsMap;
  } catch (error) {
    console.error('Error initializing projects:', error);
    // Initialize with empty projects object on error
    projects.value = {};
  }
}

export async function createProject(projectData: Omit<Project, 'id' | 'overlayIds' | 'color'>): Promise<string> {
  const id = crypto.randomUUID();
  
  const project: Project = {
    ...projectData,
    id,
    overlayIds: [],
    color: generateRandomColor()
  };
  
  await saveProject(project);
  projects.value[id] = project;
  
  toast.add({
    severity: 'success',
    summary: 'Project created',
    detail: `Project "${project.name}" has been created`,
    life: 3000
  });
  
  return id;
}

export async function getOverlaysForProject(projectId: string): Promise<OverlayObject[]> {
  const project = projects.value[projectId];
  if (!project) return [];
  
  const projectOverlays: OverlayObject[] = [];
  
  for (const overlayId of project.overlayIds) {
    if (overlays.value[overlayId]) {
      projectOverlays.push(overlays.value[overlayId]);
    }
  }
  
  return projectOverlays;
}

export async function addOverlayToProjectWithId(projectId: string, overlayId: string): Promise<void> {
  if (!projects.value[projectId]) {
    toast.add({
      severity: 'error',
      summary: 'Project not found',
      detail: 'The selected project could not be found',
      life: 3000
    });
    return;
  }
  
  if (!overlays.value[overlayId]) {
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
  
  // Update local state
  const project = projects.value[projectId];
  if (!project.overlayIds.includes(overlayId)) {
    project.overlayIds.push(overlayId);
  }
  
  // Update overlay with project reference
  const overlayObject = overlays.value[overlayId];
  overlayObject.projectId = projectId;
  
  // Apply project styling
  applyProjectStyling(overlayObject, projectId);
  
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
  
  // Update local state
  const project = projects.value[projectId];
  project.overlayIds = project.overlayIds.filter(id => id !== overlayId);
  
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

export function applyProjectStyling(overlayObject: OverlayObject, projectId: string): void {
  if (!overlayObject.overlay) return;
  
  const project = projects.value[projectId];
  if (!project) return;
  
  const element = overlayObject.overlay.getElement();
  if (!element) return;
  
  // Apply permanent and more noticeable project styling
  // Thicker border with doubled opacity
  element.style.borderLeft = `10px solid ${project.color}`;
  element.style.borderRight = `10px solid ${project.color}`;
  element.style.borderTop = `4px solid ${project.color}`;
  element.style.borderBottom = `4px solid ${project.color}`;
  
  // Add stronger glow effect for better visibility
  element.style.boxShadow = `0 0 15px ${project.color}80`; // 80 = 50% opacity for stronger effect
  
  // Add project indicator to marker
  if (overlayObject.marker) {
    // Add project name to marker tooltip
    overlayObject.marker.setTooltipContent(`${project.name}${overlayObject.phase ? ` - ${overlayObject.phase}` : ''}`);
  }
}

export function removeProjectStyling(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;
  
  const element = overlayObject.overlay.getElement();
  if (!element) return;
  
  // Remove all project styling
  element.style.borderLeft = '';
  element.style.borderRight = '';
  element.style.borderTop = '';
  element.style.borderBottom = '';
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
    if (!overlayObject || !overlayObject.overlay) continue;
    
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
    if (!overlayObject || !overlayObject.overlay) continue;
    
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
  
  // Update only the provided fields
  Object.assign(project, projectData);
  
  // Save to database
  await saveProject(project);
  
  toast.add({
    severity: 'success',
    summary: 'Project updated',
    detail: `Project "${project.name}" has been updated`,
    life: 3000
  });
}