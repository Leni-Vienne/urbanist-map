// AI : Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData } from '@types';
import type { NearbyProject } from '../types/api';
import { v4 as uuidv4 } from 'uuid';
import { buildImageUrl } from '../utils';

/**
 * AI : Calculate center position from 4 corner coordinates
 * Assumes Leaflet distortable image corner order: NW, NE, SW, SE
 * Center is calculated as midpoint between NW (corners[0]) and SE (corners[3])
 */
export function calculateCenterFromCorners(corners: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (!corners || corners.length < 4) {
    return null;
  }

  return {
    lat: (corners[0].lat + corners[3].lat) / 2,
    lng: (corners[0].lng + corners[3].lng) / 2
  };
}

/**
 * AI : Create a new Project instance with defaults
 */
export function createProject(data: Partial<Project> = {}): Project {
  const id = data.id ?? uuidv4();
  
  return {
    id,
    version: data.version ?? 1,
    name: data.name ?? '',
    description: data.description ?? null,
    sourceUrl: data.sourceUrl ?? null,
    proposalDate: data.proposalDate ?? null,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    latestUpdateOn: data.latestUpdateOn ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ownerId: data.ownerId ?? '',
    cityId: data.cityId ?? '',
    status: data.status ?? 'pending',
    // AI : DB geometry and coordinate fields
    isDevelopment: data.isDevelopment ?? false,
    coordinates: data.coordinates ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    // AI : Computed fields
    city: data.city ?? { id: '', name: '', countryCode: '', coordinates: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date() },
    overlayIds: data.overlayIds ?? [],
    color: data.color ?? '#007bff',
    savedRemotely: data.savedRemotely ?? false,
    // AI : Optional fields
    sourcePdf: data.sourcePdf ?? null,
    // AI : Map coordinates (renamed to avoid DB conflict)
    mapCoordinates: data.mapCoordinates ?? null,
    ...data
  };
}

/**
 * AI : Convert NearbyProject API data to local Project format
 */
export function createProjectFromAPI(nearbyProject: NearbyProject): Project {
  return createProject({
    id: nearbyProject.id,
    version: nearbyProject.version ?? 1,
    name: nearbyProject.name,
    description: nearbyProject.description,
    // AI : NearbyProject doesn't have these fields, use defaults
    sourceUrl: null,
    proposalDate: nearbyProject.proposalDate,
    startDate: null,
    endDate: null,
    latestUpdateOn: null,
    createdAt: nearbyProject.createdAt,
    updatedAt: nearbyProject.updatedAt,
    ownerId: nearbyProject.ownerId,
    cityId: nearbyProject.cityId,
    status: 'approved', // AI : Projects from API are approved
    city: nearbyProject.city,
    overlayIds: [],
    color: '#007bff',
    savedRemotely: true
  });
}

/**
 * AI : Create a new OverlayObject instance with defaults
 */
export function createOverlay(data: Partial<OverlayObject> = {}): OverlayObject {
  const id = data.id ?? uuidv4();

  return {
    id,
    version: data.version ?? 1,
    filename: data.filename ?? '',
    caption: data.caption ?? null,
    status: data.status ?? 'pending',
    authorId: data.authorId ?? '',
    projectId: data.projectId ?? null,
    replacesOverlayId: data.replacesOverlayId ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    centroid: data.centroid ?? { lat: 0, lng: 0 },
    corners: data.corners ?? [],
    imageUrl: data.imageUrl ?? buildImageUrl(data.filename ?? ''),
    isModified: data.isModified ?? false,
    savedRemotely: data.savedRemotely ?? false,
    overlay: data.overlay ?? null,
    marker: data.marker ?? null,
    history: data.history ?? [],
    redoStack: data.redoStack ?? [],
    isFlipped: data.isFlipped ?? false,
    currentResolution: data.currentResolution,
    project: data.project ?? null,
    ...data
  };
}

/**
 * AI : Convert OverlayData from backend to OverlayObject with UI state
 */
export function createOverlayFromCDN(overlayData: OverlayData): OverlayObject {
  const isDataUrl = overlayData.filename.startsWith('data:');
  const imageUrl = isDataUrl ? overlayData.filename : buildImageUrl(overlayData.filename);

  return createOverlay({
    ...overlayData,
    imageUrl,
    savedRemotely: !isDataUrl,
    createdAt: new Date(overlayData.createdAt),
    updatedAt: new Date(overlayData.updatedAt ?? overlayData.createdAt),
  });
}

/**
 * AI : Convert OverlayObject to OverlayData format (strips UI state for caching)
 */
export function convertOverlayToData(overlayObject: OverlayObject): OverlayData {
  // AI : Calculate centroid from corners
  const centroid = calculateCenterFromCorners(overlayObject.corners) ?? { lat: 0, lng: 0 };

  return {
    id: overlayObject.id,
    version: overlayObject.version,
    filename: overlayObject.imageUrl,
    caption: overlayObject.caption,
    status: overlayObject.status,
    projectId: overlayObject.projectId,
    authorId: overlayObject.authorId,
    replacesOverlayId: overlayObject.replacesOverlayId,
    project: null,
    centroid,
    corners: overlayObject.corners ?? [],
    distance: 0,
    createdAt: overlayObject.createdAt,
    updatedAt: overlayObject.updatedAt,
    isModified: overlayObject.isModified
  };
}

// AI : buildImageUrl imported from utils.ts