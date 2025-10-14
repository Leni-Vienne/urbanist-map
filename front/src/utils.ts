// AI : Common utility functions for the application
import { getApiUrl } from '@client';

/**
 * Creates a debounced function that delays invoking the provided function
 * until after the specified wait time has elapsed since the last invocation.
 *
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the provided function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T, 
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return function(...args: Parameters<T>): void {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * AI : Build image URL for overlay files
 * AI : Uses direct R2 public URL in production to avoid worker CPU usage
 * @param filename - The filename of the image
 * @returns The complete URL to access the image
 */
export function buildImageUrl(filename: string, forceBackendUrl = false): string {
  // AI : Force backend URL for pending overlays in production (not yet migrated to R2)
  // AI : In development, always use local server
  if (import.meta.env.PROD && !forceBackendUrl) {
    const r2PublicUrl = import.meta.env.VITE_R2_PUBLIC_URL;
    return `${r2PublicUrl}/${filename}`;
  }
  
  // AI : Use backend server URL
  return `${getApiUrl()}/uploads/${filename}`;
}

// AI : Build thumbnail URL from original filename
// Thumbnails stored in thumbnails/ subfolder both locally and on R2
// forceBackendUrl=true for pending overlays (not yet migrated to R2)
export function buildThumbnailUrl(filename: string, forceBackendUrl = false): string {
  return buildImageUrl(`thumbnails/${filename}`, forceBackendUrl);
}

/**
 * AI : Format a date as relative time (e.g., "5 minutes ago", "2 hours ago")
 * @param date - The date to format (Date object or ISO string)
 * @returns A human-readable relative time string
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) {
    return 'Unknown'
  }
  
  const now = new Date()
  const targetDate = typeof date === 'string' ? new Date(date) : date
  
  if (isNaN(targetDate.getTime())) {
    return 'Unknown'
  }
  
  const diffMs = now.getTime() - targetDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  } else if (diffWeeks < 4) {
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  } else if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  } else {
    return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
  }
}
