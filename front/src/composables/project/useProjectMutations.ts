import type { Project } from '@types';
import type { PublishProjectInput } from '../../types/api';

/**
 * AI : Builds a consistent payload for publishing projects to the backend
 * Ensures proper handling of null vs undefined for date fields
 * Date objects are passed directly as required by backend schema
 */
export function buildProjectPayload(project: Partial<Project>): PublishProjectInput {
  return {
    id: project.id,
    name: project.name!,
    description: project.description ?? undefined,
    cityId: project.cityId!,
    isDevelopment: project.isDevelopment ?? false,
    lat: project.lat ?? undefined,
    lng: project.lng ?? undefined,
    proposalDate: project.proposalDate ?? null,
    startDate: project.startDate ?? null,
    endDate: project.endDate ?? null,
    sourceUrl: project.sourceUrl ?? undefined,
    latestUpdateOn: project.latestUpdateOn ?? null,
  };
}
