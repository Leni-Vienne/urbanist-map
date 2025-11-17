import type { Project } from '@types';
import type { PublishProjectInput } from '../../types/api';

/**
 * AI : Converts a date value (string or Date) to a Date object for backend
 */
function convertToDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * AI : Builds a consistent payload for publishing projects to the backend
 * Ensures proper handling of null vs undefined for date fields
 * Converts string dates to Date objects as required by backend schema
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
    proposalDate: convertToDate(project.proposalDate),
    startDate: convertToDate(project.startDate),
    endDate: convertToDate(project.endDate),
    sourceUrl: project.sourceUrl ?? undefined,
    latestUpdateOn: convertToDate(project.latestUpdateOn),
  };
}
