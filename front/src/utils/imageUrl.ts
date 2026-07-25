import { getApiUrl } from "@/utils/apiUrl";

/**
 * Build the URL for an overlay image.
 * Uses the R2 public URL directly in production to avoid backend CPU usage.
 */
export function buildImageUrl(filename: string, forceBackendUrl = false): string {
  // Pending overlays haven't been migrated to R2 yet, so force backend URL
  if (import.meta.env.PROD && !forceBackendUrl) {
    const r2PublicUrl = import.meta.env.VITE_R2_PUBLIC_URL;
    return `${r2PublicUrl}/${filename}`;
  }

  return `${getApiUrl()}/uploads/${filename}`;
}

/**
 * Build the thumbnail URL from an original filename.
 * Thumbnails live in a thumbnails/ subfolder both locally and on R2.
 * Pass forceBackendUrl=true for pending overlays not yet migrated to R2.
 */
export function buildThumbnailUrl(filename: string, forceBackendUrl = false): string {
  return buildImageUrl(`thumbnails/${filename}`, forceBackendUrl);
}

/**
 * Returns true if the image URL requires credentials.
 * R2 CDN URLs are public; only local backend URLs need crossorigin="use-credentials".
 */
export function imageRequiresCredentials(imageUrl: string): boolean {
  const r2PublicUrl = import.meta.env.VITE_R2_PUBLIC_URL;
  if (r2PublicUrl && imageUrl.startsWith(r2PublicUrl)) {
    return false;
  }

  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return false;
  }

  return true;
}
