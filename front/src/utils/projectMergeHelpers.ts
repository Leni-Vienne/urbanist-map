// AI : Helper functions for merging local projects with backend projects
// AI : Extracted to avoid circular dependencies between composables and stores

import type { Project } from "@/types/index";
import type { StandaloneProject } from "@/utils/typeFactories";

/**
 * AI : Merge local/pending projects with backend projects for edit mode
 * AI : This function doesn't import stores, preventing circular dependencies
 * @param backendProjects - Projects fetched from backend
 * @param localProjects - Local and pending projects from projectStore
 * @param cityId - City ID to filter projects
 * @param userId - Current user ID for filtering pending projects
 * @returns Merged array of projects without duplicates
 */
export function mergeLocalProjectsWithBackend(
  backendProjects: StandaloneProject[],
  localProjects: Record<string, Project>,
  cityId: number,
  userId: string | undefined,
): StandaloneProject[] {
  // AI : Filter for local and user's pending projects for this specific city
  const relevantLocalProjects = Object.values(localProjects).filter((p) => {
    if (p.cityId !== cityId) return false;
    if (!p.lat || !p.lng) return false;

    // AI : Local projects (not yet submitted)
    if (p.status === null || p.status === undefined) return true;

    // AI : User's own pending projects (submitted but not approved)
    if (p.status === "pending" && userId && p.ownerId === userId) return true;

    return false;
  });

  // AI : Merge local projects with backend projects (avoid duplicates)
  const existingIds = new Set(backendProjects.map((p) => p.id));
  const mergedProjects: StandaloneProject[] = [...backendProjects];

  for (const localProject of relevantLocalProjects) {
    if (!existingIds.has(localProject.id)) {
      // AI : Cast as StandaloneProject (Project is compatible with the union type)
      mergedProjects.push(localProject as StandaloneProject);
    }
  }

  return mergedProjects;
}
