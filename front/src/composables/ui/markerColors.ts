import type { MarkerColor } from '@types';

/**
 * AI : Get marker color based on construction start and end dates
 * @param startDate - The construction start date (string or Date or null)
 * @param endDate - The construction end date (string or Date or null)
 * @returns 'blue' | 'grey' | 'orange'
 */
export function getConstructionMarkerColor(startDate: string | Date | null | undefined, endDate: string | Date | null | undefined): MarkerColor {
  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start && start > now) {
    return 'green';
  } else if (start && start <= now && (!end || end > now)) {
    return 'orange';
  } else if (end && end <= now) {
    return 'grey';
  }
  return 'grey';
}