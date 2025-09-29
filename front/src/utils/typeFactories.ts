// AI : Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, CDNOverlayData } from '@types';
import type { NearbyProject, BackendOverlay } from '../types/api';
import { v4 as uuidv4 } from 'uuid';
import { buildImageUrl } from '../utils';

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
    isMarker: data.isMarker ?? false,
    sourceUrl: data.sourceUrl ?? null,
    proposalDate: data.proposalDate ?? null,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    latestUpdateOn: data.latestUpdateOn ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ownerId: data.ownerId ?? '',
    cityId: data.cityId ?? null,
    status: data.status ?? 'pending',
    metadata: data.metadata ?? null,
    // AI : DB geometry and coordinate fields
    coordinates: data.coordinates ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    // AI : Computed fields
    city: data.city ?? null,
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
    metadata: nearbyProject.metadata,
    city: nearbyProject.city ? {
      id: nearbyProject.city.id,
      name: nearbyProject.city.name,
      countryCode: nearbyProject.city.countryCode,
      coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
      createdAt: new Date(),
      updatedAt: new Date()
    } : null,
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
    metadata: data.metadata ?? null,
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
export function createOverlayFromCDN(overlayData: CDNOverlayData): OverlayObject {
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
 * AI : Convert BackendOverlay API data to OverlayData format
 * After migration, BackendOverlay already has corners/centroid in correct format
 */
export function transformBackendOverlayToCDN(backendOverlay: BackendOverlay): CDNOverlayData {
  return backendOverlay as CDNOverlayData;
}

// AI : buildImageUrl imported from utils.ts