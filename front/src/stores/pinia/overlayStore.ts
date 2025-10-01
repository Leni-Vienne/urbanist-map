import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { OverlayObject, OverlayData } from '@types'
import type { BackendOverlay } from '../../types/api'

export const useOverlayStore = defineStore('overlay', () => {
  // AI : Central store for overlay data
  const overlays = shallowRef<Record<string, OverlayObject>>({})
  const idSelectedOverlay = ref<string | null>(null)
  
  // AI : Edit mode state
  const isEditMode = ref(false)
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
  const showImageUploadDialog = ref(false)
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

  const addEditModeOverlay = (overlayId: string) => {
    loadedEditOverlays.value.add(overlayId)
  }

  const removeEditModeOverlay = (overlayId: string) => {
    loadedEditOverlays.value.delete(overlayId)
  }

  const clearEditModeMarkersAndState = (mapInstance?: L.Map, editModeOverlayMarkers?: L.LayerGroup | null) => {
    // AI : Clear map markers if provided
    if (mapInstance && editModeOverlayMarkers) {
      mapInstance.removeLayer(editModeOverlayMarkers);
    }

    // AI : Clear state
    loadedEditOverlays.value.clear()
  }

  const setEditMode = (editMode: boolean) => {
    isEditMode.value = editMode
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

  const handleFileSelected = (file: File) => {
    pendingImageFile.value = file
  }

  const clearPendingFile = () => {
    pendingImageFile.value = null
  }

  const requestOverlayReplacement = (overlayId: string) => {
    replacementOverlayId.value = overlayId
    showImageUploadDialog.value = true
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
    } else if (idSelectedOverlay.value) {
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
    isEditMode,
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
    showImageUploadDialog,
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
    addEditModeOverlay,
    removeEditModeOverlay,
    clearEditModeMarkersAndState,
    setEditMode,
    saveToEditModeCache,
    getFromEditModeCache,
    clearEditModeCache,
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
