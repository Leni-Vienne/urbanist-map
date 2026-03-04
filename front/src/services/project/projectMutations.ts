import type { Project } from "@/types/index";
import type { RouterInput } from "@/client";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { createProjectObject } from "@/utils/typeFactories";

type PublishProjectInput = RouterInput["project"]["publishProject"];

/**
 * Builds a consistent payload for publishing projects to the backend
 * Ensures proper handling of null vs undefined for date fields
 * Date objects are passed directly as required by backend schema
 */
export function buildProjectPayload(project: Partial<Project>): PublishProjectInput {
  return {
    id: project.id,
    name: project.name!,
    description: project.description ?? undefined,
    cityId: project.cityId!,
    lat: project.lat!,
    lng: project.lng!,
    proposalDate: project.proposalDate ?? null,
    proposalDatePrecision: project.proposalDatePrecision ?? null,
    startDate: project.startDate ?? null,
    startDatePrecision: project.startDatePrecision ?? null,
    endDate: project.endDate ?? null,
    endDatePrecision: project.endDatePrecision ?? null,
    sourceUrl: project.sourceUrl ?? undefined,
  };
}

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
