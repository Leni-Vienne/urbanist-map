import L from 'leaflet'
import { ref } from 'vue'
import { updateMarkerPosition } from '@composables/overlay/useOverlay'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'
import type { ProjectForModeration, OverlayForModeration } from '@types'
import type { PendingChangeRequest } from '../../types/api'

/**
 * AI : Composable for handling change request display and geometry preview functionality
 * AI : Shared logic for viewing coordinate changes on the map
 */
export function useChangeRequestDisplay(
  changeRequests: () => PendingChangeRequest[],
  projects: () => ProjectForModeration[],
  onNavigateToOverlay?: (overlayId: string) => Promise<void>
) {
  const toast = useToast()
  const { t } = useI18n()
  const activeGeometryPreview = ref<{ changeId: string, type: 'old' | 'new' } | null>(null)

  /**
   * AI : Check if a field name represents geometry data
   */
  function isGeometryField(fieldName: string): boolean {
    return fieldName === 'corners' || fieldName === 'centroid'
  }

  /**
   * AI : Get change requests for a specific project (only for approved projects)
   */
  function getProjectChangeRequests(projectId: string): PendingChangeRequest[] {
    const project = projects().find(p => p.id === projectId)
    if (!project || project.status === 'pending') {
      return []
    }
    return changeRequests().filter(
      request => request.entityType === 'project' && request.entityId === projectId
    )
  }

  /**
   * AI : Get change requests for a specific overlay (only for approved overlays)
   */
  function getOverlayChangeRequests(overlayId: string): PendingChangeRequest[] {
    let overlay = null
    for (const project of projects()) {
      if (project.overlays) {
        overlay = project.overlays.find((o: OverlayForModeration) => o.id === overlayId)
        if (overlay) break
      }
    }
    if (!overlay || overlay.status === 'pending') {
      return []
    }
    return changeRequests().filter(
      request => request.entityType === 'overlay' && request.entityId === overlayId
    )
  }

  /**
   * AI : Preview geometry change on the map
   */
  async function previewGeometry(geometryValue: unknown, type: 'old' | 'new', changeId: string) {
    try {
      let corners: { lat: number, lng: number }[] = []

      if (geometryValue && typeof geometryValue === 'object') {
        const geo = geometryValue as any

        // AI : Format 1: { lat, lng } for centroid
        if ('lat' in geo && 'lng' in geo) {
          corners = [{ lat: geo.lat, lng: geo.lng }]
        }
        // AI : Format 2: [{ lat, lng }] array for corners
        else if (Array.isArray(geo) && geo.length > 0 && 'lat' in geo[0] && 'lng' in geo[0]) {
          corners = geo
        }
      }

      if (corners.length === 0) {
        toast.add({
          severity: 'warn',
          summary: t('overlay.invalidCoordinates'),
          detail: t('overlay.couldNotParseCoordinates'),
          life: 3000
        })
        return
      }

      const latLngs = corners.map(c => L.latLng(c.lat, c.lng))

      // AI : Find the change and overlay
      const change = changeRequests().find(c => c.id === changeId)

      if (change && change.entityType === 'overlay') {
        // AI : Find the overlay object in projects
        let overlayForModeration: OverlayForModeration | null = null
        for (const project of projects()) {
          if (project.overlays) {
            overlayForModeration = project.overlays.find((o: OverlayForModeration) => o.id === change.entityId) ?? null
            if (overlayForModeration) break
          }
        }

        // AI : Update overlay position in store if it exists
        const overlayStore = useOverlayStore()
        if (overlayStore.overlays[change.entityId]) {
          const overlayObject = overlayStore.overlays[change.entityId]
          if (overlayObject.overlay && corners.length === 4) {
            overlayObject.overlay.setCorners(latLngs)
            updateMarkerPosition(overlayObject)
          }
        }

        // AI : Navigate to the overlay using the provided callback (same as clicking the overlay)
        if (overlayForModeration && onNavigateToOverlay) {
          await onNavigateToOverlay(change.entityId)
        }
      }

      activeGeometryPreview.value = { changeId, type }
    } catch (error) {
      console.error('Failed to preview geometry:', error)
      toast.add({
        severity: 'error',
        summary: t('overlay.previewFailed'),
        detail: t('overlay.couldNotPreviewCoordinates'),
        life: 3000
      })
    }
  }

  /**
   * AI : Format values for display with special handling for specific fields
   */
  function formatValue(value: unknown, fieldName?: string): string {
    if (value === null || value === undefined || value === '') {
      return t('overlay.notSet')
    }

    // AI : Special handling for projectId - show project name instead of UUID
    if (fieldName === 'projectId' && typeof value === 'string') {
      const project = projects().find(p => p.id === value)
      return project?.name ?? `Unknown Project (${value.slice(0, 8)}...)`
    }

    // AI : Special handling for geometry fields
    if (fieldName === 'corners' || fieldName === 'centroid') {
      return t('overlay.coordinatesViewOnMap')
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  return {
    activeGeometryPreview,
    isGeometryField,
    getProjectChangeRequests,
    getOverlayChangeRequests,
    previewGeometry,
    formatValue
  }
}
