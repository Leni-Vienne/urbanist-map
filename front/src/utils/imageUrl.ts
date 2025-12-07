import { getApiUrl } from "@/client";

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

/**
 * AI : Build thumbnail URL from original filename
 * Thumbnails stored in thumbnails/ subfolder both locally and on R2
 * forceBackendUrl=true for pending overlays (not yet migrated to R2)
 */
export function buildThumbnailUrl(filename: string, forceBackendUrl = false): string {
  return buildImageUrl(`thumbnails/${filename}`, forceBackendUrl);
}
