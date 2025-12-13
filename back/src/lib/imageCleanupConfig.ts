// AI : Image cleanup configuration constants
// AI : Centralized place for retention periods and cleanup-related settings

/**
 * AI : Number of days to keep thumbnails after an overlay is rejected or replaced.
 * AI : This allows moderators to review decisions and users to appeal before files are permanently deleted.
 */
export const THUMBNAIL_RETENTION_DAYS = 15;

/**
 * AI : Number of days to keep full images after an overlay is replaced.
 * AI : Replaced overlays use scheduled deletion to allow for undo/recovery.
 */
export const REPLACED_IMAGE_RETENTION_DAYS = 15;

/**
 * AI : Different retention periods for different environments.
 * AI : In development, we might want shorter retention for testing.
 */
export const IMAGE_CLEANUP_CONFIG = {
  // AI : Days to keep thumbnails after rejection/replacement
  thumbnailRetentionDays: THUMBNAIL_RETENTION_DAYS,

  // AI : Days to keep full images after replacement
  replacedImageRetentionDays: REPLACED_IMAGE_RETENTION_DAYS,
} as const;
