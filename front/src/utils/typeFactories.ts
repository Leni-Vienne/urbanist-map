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
    // AI : Computed fields
    city: data.city ?? null,
    overlayIds: data.overlayIds ?? [],
    color: data.color ?? '#007bff',
    savedRemotely: data.savedRemotely ?? false,
    // AI : Optional fields
    sourcePdf: data.sourcePdf ?? null,
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
    authorId: data.authorId ?? '',
    projectId: data.projectId ?? null,
    replacesOverlayId: data.replacesOverlayId ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    status: data.status ?? 'pending',
    topLeftLat: data.topLeftLat ?? 0,
    topLeftLng: data.topLeftLng ?? 0,
    topRightLat: data.topRightLat ?? 0,
    topRightLng: data.topRightLng ?? 0,
    bottomRightLat: data.bottomRightLat ?? 0,
    bottomRightLng: data.bottomRightLng ?? 0,
    bottomLeftLat: data.bottomLeftLat ?? 0,
    bottomLeftLng: data.bottomLeftLng ?? 0,
    metadata: data.metadata ?? null,
    // AI : Computed fields
    imageUrl: data.imageUrl ?? buildImageUrl(data.filename ?? ''),
    centroid: data.centroid ?? { x: 0, y: 0 },
    corners: data.corners ?? [],
    isModified: data.isModified ?? false,
    savedRemotely: data.savedRemotely ?? false,
    // AI : Map interaction fields
    overlay: data.overlay ?? null,
    marker: data.marker ?? null,
    // AI : Editor state
    history: data.history ?? [],
    redoStack: data.redoStack ?? [],
    isFlipped: data.isFlipped ?? false,
    currentResolution: data.currentResolution,
    project: data.project ?? null,
    ...data
  };
}

/**
 * AI : Convert CDNOverlayData to OverlayObject
 */
export function createOverlayFromCDN(cdnOverlay: CDNOverlayData): OverlayObject {
  const corners = cdnOverlay.corners?.length === 4 ? cdnOverlay.corners : [
    { lat: cdnOverlay.centroid.lat - 0.001, lng: cdnOverlay.centroid.lng - 0.001 },
    { lat: cdnOverlay.centroid.lat - 0.001, lng: cdnOverlay.centroid.lng + 0.001 },
    { lat: cdnOverlay.centroid.lat + 0.001, lng: cdnOverlay.centroid.lng + 0.001 },
    { lat: cdnOverlay.centroid.lat + 0.001, lng: cdnOverlay.centroid.lng - 0.001 }
  ];

  return createOverlay({
    id: cdnOverlay.id,
    version: cdnOverlay.version,
    filename: cdnOverlay.filename,
    caption: cdnOverlay.caption,
    projectId: cdnOverlay.projectId ?? null,
    replacesOverlayId: cdnOverlay.replacesOverlayId ?? null,
    createdAt: new Date(cdnOverlay.createdAt),
    imageUrl: buildImageUrl(cdnOverlay.filename),
    centroid: { x: cdnOverlay.centroid.lng, y: cdnOverlay.centroid.lat },
    corners,
    topLeftLat: corners[0].lat,
    topLeftLng: corners[0].lng,
    topRightLat: corners[1].lat,
    topRightLng: corners[1].lng,
    bottomRightLat: corners[2].lat,
    bottomRightLng: corners[2].lng,
    bottomLeftLat: corners[3].lat,
    bottomLeftLng: corners[3].lng,
    isModified: cdnOverlay.isModified ?? false,
    savedRemotely: true,
    project: cdnOverlay.project as Project | null
  });
}

/**
 * AI : Convert BackendOverlay API data to CDNOverlayData format
 */
export function transformBackendOverlayToCDN(backendOverlay: BackendOverlay): CDNOverlayData {
  return {
    id: backendOverlay.id,
    version: backendOverlay.version,
    filename: backendOverlay.filename,
    caption: backendOverlay.caption ?? null,
    projectId: backendOverlay.projectId,
    replacesOverlayId: backendOverlay.replacesOverlayId ?? null,
    project: backendOverlay.projectName ? {
      id: backendOverlay.projectId ?? '',
      version: 1,
      name: backendOverlay.projectName,
      description: null,
      sourceUrl: null,
      proposalDate: null,
      startDate: null,
      endDate: null,
      latestUpdateOn: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerId: '',
      cityId: backendOverlay.cityName ? 'unknown' : null,
      status: 'approved',
      metadata: null,
      city: backendOverlay.cityName ? {
        id: 'unknown',
        name: backendOverlay.cityName,
        countryCode: 'unknown',
        coordinates: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date()
      } : null
    } : null,
    corners: [
      { lat: backendOverlay.topLeftLat, lng: backendOverlay.topLeftLng },
      { lat: backendOverlay.topRightLat, lng: backendOverlay.topRightLng },
      { lat: backendOverlay.bottomRightLat, lng: backendOverlay.bottomRightLng },
      { lat: backendOverlay.bottomLeftLat, lng: backendOverlay.bottomLeftLng }
    ],
    centroid: {
      lat: backendOverlay.centroid.y,
      lng: backendOverlay.centroid.x
    },
    distance: 0,
    createdAt: backendOverlay.createdAt,
    isModified: false
  };
}

// AI : buildImageUrl imported from utils.ts