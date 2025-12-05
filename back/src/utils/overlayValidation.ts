// AI : Re-export validation functions from shared for backward compatibility
export type { OverlaySizeValidationResult } from '@shared/overlayValidation';
export {
  validateOverlaySize,
  leafletCornersToCorners,
  calculateCentroidFromCorners,
} from '@shared/overlayValidation';
