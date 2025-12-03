// AI : Re-export validation functions from shared for backward compatibility
export type { OverlaySizeValidationResult } from '../shared/validation';
export {
  validateOverlaySize,
  leafletCornersToCorners,
  calculateCentroidFromCorners,
} from '../shared/validation';
