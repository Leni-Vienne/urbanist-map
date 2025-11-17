import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type L from 'leaflet'
import type { OverlayObject, OverlayData, MapMode } from '@types'
import type { BackendOverlay } from '../../types/api'

export const useOverlayStore = defineStore('overlay', () => {
  // AI : Central store for overlay data
  const overlays = shallowRef<Record<string, OverlayObject>>({})
  const idSelectedOverlay = ref<string | null>(null)

  // AI : Tracking of all markers, even for images not currently loaded
  const allMarkers = shallowRef<Record<string, L.Marker>>({})

  // AI : Map mode state (view, edit, or moderation)
  const mode = ref<MapMode>('view')
  const isTogglingMode = ref(false)

  // AI : Edit mode overlay cache - stores overlay modifications for persistence across zoom changes
  type EditModeCache = { corners: { lat: number, lng: number }[], isModified: boolean }
  const editModeOverlayCache = ref<Map<string, EditModeCache>>(new Map())

  // AI : Overlay data for different modes
  const viewModeOverlays = ref<OverlayData[]>([])
  const loadedEditOverlays = ref<Set<string>>(new Set())
  const overlaysLoading = ref(false)
  const overlaysError = ref<string | null>(null)

  // AI : Latest overlays cache - simple loaded flag
  const latestOverlays = ref<BackendOverlay[]>([])
  const latestOverlaysLoading = ref(false)
  const latestOverlaysLoaded = ref(false)

  // AI : UI state
  const replacementOverlayId = ref<string | null>(null)
  const pendingImageFile = ref<File | null>(null)
  const showInfoPopup = ref(false)
  const infoPopupOverlayId = ref<string | null>(null)

  // AI : Basic actions
  const setViewModeOverlays = (overlayData: OverlayData[]) => {
    viewModeOverlays.value = overlayData
    overlaysError.value = null
  }

  const clearViewModeOverlays = () => {
    viewModeOverlays.value = []
    overlaysError.value = null
  }

  const setOverlaysLoading = (loading: boolean) => {
    overlaysLoading.value = loading
  }

  const setOverlaysError = (error: string | null) => {
    overlaysError.value = error
  }

  // AI : Latest overlays actions
  const setLatestOverlays = (overlays: BackendOverlay[]) => {
    latestOverlays.value = overlays
    latestOverlaysLoaded.value = true
  }

  const setLatestOverlaysLoading = (loading: boolean) => {
    latestOverlaysLoading.value = loading
  }

  // AI : Reset latest overlays cache to force refresh on next load
  const resetLatestOverlays = () => {
    latestOverlaysLoaded.value = false
  }

  const addEditModeOverlay = (overlayId: string) => {
    loadedEditOverlays.value.add(overlayId)
  }

  const removeEditModeOverlay = (overlayId: string) => {
    loadedEditOverlays.value.delete(overlayId)
  }

  const clearEditModeMarkersAndState = () => {
    // AI : Clear state
    loadedEditOverlays.value.clear()
  }

  const setMode = (newMode: MapMode) => {
    mode.value = newMode
  }

  // AI : Edit mode cache management
  function saveToEditModeCache(overlayId: string, data: EditModeCache) {
    editModeOverlayCache.value.set(overlayId, data)
  }

  function getFromEditModeCache(overlayId: string): EditModeCache | undefined {
    return editModeOverlayCache.value.get(overlayId)
  }

  function clearEditModeCache() {
    editModeOverlayCache.value.clear()
  }

  // AI : Update overlay in store with proper reactivity for shallowRef
  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = overlays.value[overlayId]
    if (current == null) return

    // AI : Create new object with updates to trigger reactivity
    overlays.value = {
      ...overlays.value,
      [overlayId]: { ...current, ...updates }
    }
  }

  const handleFileSelected = (file: File) => {
    pendingImageFile.value = file
  }

  const clearPendingFile = () => {
    pendingImageFile.value = null
  }

  const requestOverlayReplacement = (overlayId: string) => {
    replacementOverlayId.value = overlayId
  }

  const resetReplacement = () => {
    replacementOverlayId.value = null
    clearPendingFile()
  }

  const showInfoPopupForOverlay = (overlayId: string) => {
    infoPopupOverlayId.value = overlayId
    showInfoPopup.value = true
  }

  const hideInfoPopup = () => {
    showInfoPopup.value = false
    infoPopupOverlayId.value = null
  }

  const toggleInfoPopup = () => {
    if (showInfoPopup.value) {
      hideInfoPopup()
    } else if (idSelectedOverlay.value != null) {
      showInfoPopupForOverlay(idSelectedOverlay.value)
    }
  }

  const resetAllUIStates = () => {
    hideInfoPopup()
    resetReplacement()
  }

  const closeAllUIElements = () => {
    hideInfoPopup()
    // AI : Don't reset replacement (which clears pendingImageFile) if we have a pending file
    // AI : This preserves the file during dialog navigation in overlay import flow
    if (!pendingImageFile.value) {
      resetReplacement()
    }
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    allMarkers,
    mode,
    isTogglingMode,
    editModeOverlayCache,
    viewModeOverlays,
    loadedEditOverlays,
    overlaysLoading,
    overlaysError,
    latestOverlays,
    latestOverlaysLoading,
    latestOverlaysLoaded,
    replacementOverlayId,
    pendingImageFile,
    showInfoPopup,
    infoPopupOverlayId,

    // Actions
    setViewModeOverlays,
    clearViewModeOverlays,
    setOverlaysLoading,
    setOverlaysError,
    setLatestOverlays,
    setLatestOverlaysLoading,
    resetLatestOverlays,
    addEditModeOverlay,
    removeEditModeOverlay,
    clearEditModeMarkersAndState,
    setMode,
    saveToEditModeCache,
    getFromEditModeCache,
    clearEditModeCache,
    updateOverlay,
    handleFileSelected,
    clearPendingFile,
    requestOverlayReplacement,
    resetReplacement,
    showInfoPopupForOverlay,
    hideInfoPopup,
    toggleInfoPopup,
    resetAllUIStates,
    closeAllUIElements
  }
})
