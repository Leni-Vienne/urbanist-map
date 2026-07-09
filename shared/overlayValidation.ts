interface Corner {
  lat: number;
  lng: number;
}

// Maximum dimensions in meters
const MAX_WIDTH_METERS = 1000;
const MAX_HEIGHT_METERS = 1000;
const MAX_DIAGONAL_METERS = 1450;

// Distance between two lat/lng points using the Haversine formula
function calculateDistance(point1: Corner, point2: Corner): number {
  const R = 6_371_000; // Earth's radius in meters
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

interface OverlaySizeValidationResult {
  isValid: boolean;
}

// Validate overlay corner positions against maximum size constraints
export function validateOverlaySize(corners: Corner[]): OverlaySizeValidationResult {
  if (corners.length !== 4) {
    return { isValid: false };
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  /*oxlint-disable no-non-null-assertion*/
  const topEdge = calculateDistance(topLeft!, topRight!);
  const bottomEdge = calculateDistance(bottomLeft!, bottomRight!);
  const leftEdge = calculateDistance(topLeft!, bottomLeft!);
  const rightEdge = calculateDistance(topRight!, bottomRight!);

  const diagonalTLBR = calculateDistance(topLeft!, bottomRight!);
  const diagonalTRBL = calculateDistance(topRight!, bottomLeft!);
  /*oxlint-enable no-non-null-assertion*/

  const isValid =
    topEdge <= MAX_WIDTH_METERS &&
    bottomEdge <= MAX_WIDTH_METERS &&
    leftEdge <= MAX_HEIGHT_METERS &&
    rightEdge <= MAX_HEIGHT_METERS &&
    diagonalTLBR <= MAX_DIAGONAL_METERS &&
    diagonalTRBL <= MAX_DIAGONAL_METERS;

  return { isValid };
}

export function calculateCentroidFromCorners(corners: Corner[]): Corner | null {
  if (corners.length !== 4) {
    return null;
  }

  return {
    //oxlint-disable-next-line no-non-null-assertion
    lat: (corners[0]!.lat + corners[1]!.lat + corners[2]!.lat + corners[3]!.lat) / 4,
    //oxlint-disable-next-line no-non-null-assertion
    lng: (corners[0]!.lng + corners[1]!.lng + corners[2]!.lng + corners[3]!.lng) / 4,
  };
}
