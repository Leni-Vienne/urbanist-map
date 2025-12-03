// AI : Shared validation logic for overlays (used by both frontend and backend)

interface Corner {
  lat: number;
  lng: number;
}

// AI : Maximum dimensions in meters
const MAX_WIDTH_METERS = 1000;
const MAX_HEIGHT_METERS = 1000;
const MAX_DIAGONAL_METERS = 1450;

// AI : Calculate distance between two points using Haversine formula (same as PostGIS ST_Distance on geography)
function calculateDistance(point1: Corner, point2: Corner): number {
  const R = 6371000; // AI : Earth's radius in meters
  const lat1 = (point1.lat * Math.PI) / 180;
  const lat2 = (point2.lat * Math.PI) / 180;
  const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const deltaLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface OverlaySizeValidationResult {
  isValid: boolean;
}

// AI : Validate overlay size constraints
export function validateOverlaySize(corners: Corner[]): OverlaySizeValidationResult {
  if (!corners || corners.length !== 4) {
    return { isValid: false };
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  // AI : Calculate distances for all edges
  const topEdge = calculateDistance(topLeft, topRight);
  const bottomEdge = calculateDistance(bottomLeft, bottomRight);
  const leftEdge = calculateDistance(topLeft, bottomLeft);
  const rightEdge = calculateDistance(topRight, bottomRight);

  // AI : Calculate diagonals
  const diagonalTLBR = calculateDistance(topLeft, bottomRight);
  const diagonalTRBL = calculateDistance(topRight, bottomLeft);

  // AI : Check if any dimension exceeds limits
  const isValid =
    topEdge <= MAX_WIDTH_METERS &&
    bottomEdge <= MAX_WIDTH_METERS &&
    leftEdge <= MAX_HEIGHT_METERS &&
    rightEdge <= MAX_HEIGHT_METERS &&
    diagonalTLBR <= MAX_DIAGONAL_METERS &&
    diagonalTRBL <= MAX_DIAGONAL_METERS;

  return { isValid };
}

// AI : Helper to convert Leaflet LatLng to Corner interface
export function leafletCornersToCorners(leafletCorners: Array<{ lat: number; lng: number }>): Corner[] {
  return leafletCorners.map(c => ({ lat: c.lat, lng: c.lng }));
}

/**
 * AI : Calculate centroid from 4 corner coordinates using average of all corners
 * AI : Used for consistent centroid calculation across frontend and backend
 */
export function calculateCentroidFromCorners(corners: Corner[]): Corner | null {
  if (!corners || corners.length !== 4) {
    return null;
  }

  return {
    lat: (corners[0].lat + corners[1].lat + corners[2].lat + corners[3].lat) / 4,
    lng: (corners[0].lng + corners[1].lng + corners[2].lng + corners[3].lng) / 4
  };
}
