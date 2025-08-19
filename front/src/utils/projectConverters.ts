import type { Project } from '@types'
import type { NearbyProject } from '../types/api'

/**
 * AI : Converts a NearbyProject to a local Project format
 * This eliminates duplication between projectStore and InfoPopupContainer
 */
export function convertNearbyProjectToLocal(nearbyProject: NearbyProject): Project {
  return {
    id: nearbyProject.id,
    name: nearbyProject.name,
    description: nearbyProject.description ?? '',
    overlayIds: [],
    color: '#007bff',
    cityId: nearbyProject.cityId,
    status: 'approved' as const,
    ownerId: nearbyProject.ownerId,
    createdAt: nearbyProject.createdAt,
    updatedAt: nearbyProject.updatedAt,
    metadata: nearbyProject.metadata,
    city: nearbyProject.city ? {
      id: nearbyProject.city.id,
      name: nearbyProject.city.name,
      countryCode: nearbyProject.city.countryCode,
      coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
      createdAt: null,
      updatedAt: new Date()
    } : undefined,
    sourceUrl: null,
    startDate: null,
    endDate: null,
    latestUpdateOn: null,
    savedRemotely: true
  }
}

/**
 * AI : Converts a NearbyProject to backend project format for overlay object
 * This eliminates duplication in InfoPopupContainer
 */
export function convertNearbyProjectToBackend(nearbyProject: NearbyProject) {
  return {
    id: nearbyProject.id,
    status: 'approved' as const,
    name: nearbyProject.name,
    description: nearbyProject.description ?? null,
    createdAt: nearbyProject.createdAt,
    updatedAt: nearbyProject.updatedAt,
    ownerId: nearbyProject.ownerId,
    cityId: nearbyProject.cityId,
    startDate: null,
    endDate: null,
    sourceUrl: null,
    latestUpdateOn: null,
    metadata: nearbyProject.metadata,
    city: nearbyProject.city ? {
      id: nearbyProject.city.id,
      name: nearbyProject.city.name,
      countryCode: nearbyProject.city.countryCode,
      coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
      createdAt: null,
      updatedAt: new Date()
    } : null
  }
}