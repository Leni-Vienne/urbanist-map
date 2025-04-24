<template>
  <Toast />
  <div
    id="viewerDiv"
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"
  >
    <div class="map-buttons">

      <input
        type="file"
        @change="onImageUpload"
        accept="image/png, image/jpeg"
      />
      <!--<FileUpload mode="basic" accept="image/png, image/jpeg" :maxFileSize="1000000" @upload="onImageUpload" />-->
      <div class="card flex">
        <Drawer
          v-model:visible="visible"
          header="Drawer"
          :dismissableMask="true"
        >
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et
            dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex
            ea commodo consequat.</p>
        </Drawer>
        <Button
          icon="pi pi-bars"
          @click="visible = true"
        />
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="toggleEditMode">{{ isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode' }}</Button>
        </div>
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="clearIndexedDB">Clear Local Storage</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import L from "leaflet";

// Extend Leaflet namespace to include custom actions
declare module "leaflet" {
  const DistortAction: any;
  const FreeRotateAction: any;
  const OpacityAction: any;
  const OpacitiesAction: any;
  const DeleteAction: any;
  const StackAction: any;
  const Toolbar2: any;
  const EditAction: any;

  // Définition de l'interface pour DistortableImageOverlay
  interface DistortableImageOverlay extends L.ImageOverlay {
    editing: {
      _disableKeyboard: () => void;
      addTool: (tool: any) => void;
      removeTool: (tool: any) => void;
    };
    getCorners: () => { lat: number, lng: number }[];
    setCorners: (corners: { lat: number, lng: number }[]) => void;
    bindTooltip: (content: string, options?: L.TooltipOptions) => this;
    openTooltip: () => this;
  }

  // Ajout de la fonction distortableImageOverlay
  function distortableImageOverlay(
    imageUrl: string,
    options?: any
  ): DistortableImageOverlay;
}
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import 'leaflet/dist/leaflet.css';
import 'leaflet-toolbar/dist/leaflet.toolbar.css';
import "leaflet-distortableimage-updated/dist/leaflet.distortableimage.css";
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { getCurrentInstance, onMounted, ref, shallowRef } from 'vue';
import { createVNode, render } from 'vue';
import { DBSchema, openDB, IDBPDatabase } from 'idb';
import InfoPopup from './components/InfoPopup.vue';
import { useToast } from "primevue/usetoast";

const toast = useToast();
const visible = ref(false);

// Type pour les données à stocker dans IndexedDB
export type StoredOverlayData = {
  id: string;
  imageUrl: string;
  corners: { lat: number, lng: number }[];
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  info: info | null;
}

export type info = {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
}

// Type complet pour l'utilisation pendant l'exécution
export type overlayObject = StoredOverlayData & {
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
  alreadyLoaded: boolean; // Track if the overlay is already loaded in the page
  alreadyStored: boolean; // Track if the overlay is already stored in IndexedDB
  whitePixelsHidden: boolean; // Track if white pixels are hidden or visible
}

type mapPosition = {
  key: string;
  value: {
    center: number[];
    zoom: number;
  };
}

interface MyDB extends DBSchema {
  mapPosition: {
    key: string;
    value: mapPosition
  };
  overlays: {
    key: string;
    value: StoredOverlayData;
  }
}

const map = shallowRef<L.Map | null>(null); // shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
const overlays = shallowRef<Record<string, overlayObject>>({}); // Store overlays as a Record
const idSelectedOverlay = ref<string | null>(null); // Track the ID of the currently selected overlay
const imageUrl = ref<string | null>(null);
const isEditMode = ref<boolean>(true);
const app = getCurrentInstance()
let db: IDBPDatabase<MyDB> | null = null;

onMounted(async () => {
  await initializeDatabase();
  await initializeMap();
  await getOverlaysFromIndexedDB();

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'z') {
      undo();
    } else if (event.ctrlKey && event.key === 'y') {
      redo();
    }
  }, true);

  // Call this after map and overlays are initialized
  disableLeafletKeyboardEvents()
});

async function initializeDatabase() {
  db = await openDB('CityMapOverlayDB', 1, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains('overlays')) {
        upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
        upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
      }
    },
  });
}

async function initializeMap() {
  L.latLng
  const savedPosition = await getSavedMapPosition();

  // Default coordinates for Paris if no saved position is found
  const defaultLat = 48.8566;
  const defaultLng = 2.3522;
  const defaultZoom = 13;

  // Use saved position or defaults
  const center = savedPosition ? savedPosition.center : [defaultLat, defaultLng];
  const zoom = savedPosition ? savedPosition.zoom : defaultZoom;

  const initialView: L.LatLngExpression = { lat: center[0], lng: center[1] };

  map.value = L.map("viewerDiv").setView(initialView, zoom);
  if (!map.value) throw new Error('No map element found');

  // Save default position if none exists
  if (!savedPosition) {
    saveMapPosition();
  }

  addTileLayer();
  map.value.on('moveend', saveMapPosition);
  map.value.on('zoomend', saveMapPosition);
}

async function getSavedMapPosition() {
  if (!db) return null;
  const savedPosition = await db.get('mapPosition', 'position');
  return savedPosition ? savedPosition.value : null;
}

function addTileLayer() {
  if (!map.value) return;
  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 19, // TODO cannot go to 20 with data.geopf.fr, I need to search why
      tileSize: 256,
      attribution: "IGN-F/Géoportail"
    }
  ).addTo(map.value);
}

async function getOverlaysFromIndexedDB() {
  if (!db) return;

  const savedOverlays = await fetchSavedOverlays();
  savedOverlays.forEach(async (savedOverlay) => {
    const overlayObject = createOverlayObject(savedOverlay);
    const newOverlay = await createOverlay(savedOverlay.imageUrl, overlayObject);
    overlayObject.overlay = newOverlay!;
    overlays.value[savedOverlay.id] = overlayObject;
  });
}

async function fetchSavedOverlays() {
  if (!db) return [];
  const transaction = db.transaction('overlays', 'readonly');
  const store = transaction.objectStore('overlays');
  return await store.getAll();
}

function createOverlayObject(savedOverlay: StoredOverlayData): overlayObject {
  return {
    ...savedOverlay,
    overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
  };
}

async function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    imageUrl.value = reader.result as string; // Store base64 string
    await addOverlay();
  };
  reader.readAsDataURL(file); // Convert file to base64
}

const centerTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<span>Center Map</span>',
      tooltip: 'Center map on the selected overlay',
    },
  },
  addHooks: function () {
    if (!idSelectedOverlay.value) {
      alert('No overlay selected!');
      return;
    }
    const overlayObject = overlays.value[idSelectedOverlay.value];
    if (overlayObject && overlayObject.overlay) {
      const bounds = overlayObject.overlay.getBounds();
      map.value?.fitBounds(bounds);
    }
  },
})

const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo",
      tooltip: 'Undo',
    },
  },
  addHooks: function () {
    undo();
  },
})

const redoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo icon-flipped",
      tooltip: 'Redo',
    },
  },
  addHooks: function () {
    redo();
  },
})

const resetRatioTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-up-right-and-arrow-down-left-from-center",
      tooltip: 'Restore image ratio',
    },
  },
  addHooks: function () {
    resetImageRatio();
  },
})

const backgroundTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-eraser",

    },
  },
  addHooks: async function () {
    await toggleWhitePixels();
  },
})


/**
 * Toolbar icon and subtoolbar heavily inspired by the L.OpacitiesAction action.
 * opens a div where text can be displayed, links clicked, etc.
 * can probably be way simplified, but this works for now.
 */
const infoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: 'pi pi-info-circle',
    },
    subToolbar: new L.Toolbar2({
      actions: [L.EditAction.extend({
        options: {
          toolbarIcon: {
            tooltip: "Info",
            className: "more-info-popup",
          },
        },
        initialize: function () {
          L.EditAction.prototype.initialize.apply(this, arguments);
        }
      })],
    })
  },
  addHooks() {
    const link = this._link;
    if (L.DomUtil.hasClass(link, "subtoolbar_enabled")) {
      L.DomUtil.removeClass(link, "subtoolbar_enabled");

      // this ime out allows the popup to be removed is the user clicks on the icon again
      setTimeout(() => {
        this.options.subToolbar._hide();
      }, 100);

    } else {
      L.DomUtil.addClass(link, "subtoolbar_enabled");

      setTimeout(() => {
        if (!idSelectedOverlay.value) return;

        // no idea why but we need to get the element by its class name and not by its id
        const popupElement = document.getElementsByClassName("more-info-popup")[0];

        if (!popupElement || popupElement.tagName !== 'A') {
          return
        }
        const newDiv = document.createElement('div');
        newDiv.className = "leaflet-toolbar-icon more-info-popup";
        newDiv.id = "info-popup-container";
        if (popupElement.parentNode) {
          popupElement.parentNode.replaceChild(newDiv, popupElement);
        } else {
          return
        }

        const vnode = createVNode(InfoPopup, {
          overlayObject: overlays.value[idSelectedOverlay.value],
          onProjectSubmit: handleProjectSubmit,
        });
        vnode.appContext = app?.appContext ?? null;
        render(vnode, newDiv);
      }, 10);
    }

    (L as any).IconUtil.toggleXlink(link, "information", "close");
    (L as any).IconUtil.toggleTitle(link, "Close", "About");
  }
});

// Function to handle project data submitted from InfoPopup
function handleProjectSubmit(projectInfo: info & { id: string }) {

  if (!projectInfo.id || !overlays.value[projectInfo.id]) {
    console.error('Overlay not found for ID in handleProjectSumbit:', projectInfo.id);
    return;
  }

  const overlay = overlays.value[projectInfo.id];
  overlay.info = {
    projectName: projectInfo.projectName,
    sourceLink: projectInfo.sourceLink,
    startDate: projectInfo.startDate,
    endDate: projectInfo.endDate,
    budget: projectInfo.budget
  };

  updateTooltipText(); // Update tooltip text with project name

  // Update tooltip text with project name
  toast.add({ severity: 'success', summary: 'Success', detail: 'Message Content', life: 3000 });

  // Save to IndexedDB
  saveImageAndPosition();

  // Close the info popup (optional)
  const infoLink = document.querySelector('.pi-info-circle');
  if (infoLink && infoLink instanceof HTMLElement) {
    infoLink.click();
  }
}

// all actions (not all in docs) : L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.DeleteAction, L.StackAction, L.EditAction, L.RotateAction, L.ScaleAction, L.TranslateAction, L.OpacitiesAction, L.GeolocateAction, L.RestoreAction, L.UnlockAction
// L.EditAction is empty
// L.TranslateAction crashes
// L.UnlockAction is useless
// L.GeolocateAction crashes "ReferenceError: EXIF is not defined"
// L.RestoreAction undistorts the image
// L.OpacitiesAction works well!
const editTools = [undoTool, redoTool, resetRatioTool, backgroundTool, L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.OpacitiesAction, L.DeleteAction, L.StackAction]
const viewTools = [centerTool, resetRatioTool, backgroundTool, L.OpacityAction, L.OpacitiesAction, L.StackAction]


async function createOverlay(imageUrl: string, overlayObject?: overlayObject) {
  if (!map.value || !overlayObject) return null;

  // if it's the first time we create the overlay, we need to set the imageUrl
  if (!overlayObject.imageUrl) {
    overlayObject.imageUrl = imageUrl;
  }

  const newOverlay = L.distortableImageOverlay(imageUrl, {
    editable: true,
    tooltipText: overlayObject.info?.projectName,
    keyboard: false,
    actions: [
      infoTool,
      undoTool,
      redoTool,
      resetRatioTool,
      backgroundTool,
      L.DistortAction,
      L.FreeRotateAction,
      L.OpacityAction,
      L.OpacitiesAction,
      L.DeleteAction,
      L.StackAction,
    ],
  }).addTo(map.value);

  overlayObject.overlay = newOverlay;

  // Explicitly disable keyboard handling on the overlay
  if (newOverlay.editing && newOverlay.editing._disableKeyboard) {
    newOverlay.editing._disableKeyboard();
  }

  newOverlay.on('edit', () => {
    saveToHistory(overlayObject);
    saveImageAndPosition();
    updateMarkerPosition(overlayObject);
  });
  newOverlay.on('dragend', () => {
    saveToHistory(overlayObject);
    saveImageAndPosition();
    updateMarkerPosition(overlayObject);
  });
  newOverlay.on('select', () => {
    idSelectedOverlay.value = overlayObject.id;
  });

  // allows to access the corners of the image on load since newOverlay.on('load') doesn't work
  // credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228

  const element = newOverlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return null;
  }
  L.DomEvent.on(element, 'load', () => {
    if (overlayObject.alreadyStored || overlayObject.alreadyLoaded) {
      (overlayObject.overlay as any).setCorners(overlayObject.history.at(-1));
    }

    if (!overlayObject.alreadyLoaded) {
      saveToHistory(overlayObject);
      const marker = createMarker(overlayObject);
      if (marker) {
        overlayObject.marker = marker;
      } else {
        console.error('Failed to create marker for overlay:', overlayObject.id);
      }
    }

    overlayObject.alreadyLoaded = true
    overlayObject.alreadyStored = true
  });
  return newOverlay;
}

function createMarker(overlayObject: overlayObject) {
  if (!map.value || !overlayObject.overlay) return null;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  const marker = L.marker(center).addTo(map.value);
  return marker;
}

function updateMarkerPosition(overlayObject: overlayObject) {
  if (!overlayObject.overlay || !overlayObject.marker) return;

  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

async function saveMapPosition() {
  if (!map.value || !db) return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();
  const position = { key: 'position', value: { center: [center.lat, center.lng], zoom } };

  const transaction = db.transaction('mapPosition', 'readwrite');
  const store = transaction.objectStore('mapPosition');
  await store.put(position);
}

function saveImageAndPosition() {
  if (!db) return;

  const savedOverlays: StoredOverlayData[] = Object.values(overlays.value).map(overlayObj => {

    const element = overlayObj.overlay?.getElement();
    return {
      id: overlayObj.id,
      imageUrl: element?.src || overlayObj.imageUrl,
      corners: overlayObj.overlay?.getCorners() || [],
      history: overlayObj.history,
      redoStack: overlayObj.redoStack,
      info: overlayObj.info || {
        projectName: '',
        sourceLink: '',
        startDate: null,
        endDate: null,
        budget: 0
      }
    };
  });

  // Save overlays to IndexedDB
  const transaction = db.transaction('overlays', 'readwrite');
  const store = transaction.objectStore('overlays');
  for (const overlay of savedOverlays) {
    store.put(overlay);
  }
}

function saveToHistory(overlayObject: overlayObject) {
  if (!overlayObject.overlay) return;
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = []; // Clear redo stack for this overlay
}

async function addOverlay() {
  if (!map.value || !imageUrl.value) return;

  const id = crypto.randomUUID();
  const overlayObject: overlayObject = {
    id,
    imageUrl: imageUrl.value,
    overlay: null,
    marker: null,
    history: [],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: false,
    corners: [],
    info: {
      projectName: '',
      sourceLink: '',
      startDate: null,
      endDate: null,
      budget: 0
    },
    whitePixelsHidden: false,
  };

  const newOverlay = await createOverlay(imageUrl.value, overlayObject);
  if (!newOverlay) return;

  overlays.value[id] = overlayObject;
}

function undo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (history.length <= 1) return;

  const lastState = history.pop()!;
  redoStack.push(lastState);

  const previousState = history[history.length - 1];
  (overlay as any).setCorners(previousState);

  updateMarkerPosition(overlayObject);
  saveImageAndPosition();
}

function redo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (redoStack.length === 0) return;

  const nextState = redoStack.pop()!;
  history.push(nextState);

  (overlay as any).setCorners(nextState);

  updateMarkerPosition(overlayObject);
  saveImageAndPosition();
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  // adding and removing tools is finicky (tools are often removed from the arrays) but this way works
  Object.values(overlays.value).forEach((overlayObject) => {
    const editing = (overlayObject.overlay as any).editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }
  });
}

async function toggleWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  // Toggle the state
  overlayObject.whitePixelsHidden = !overlayObject.whitePixelsHidden;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !map.value) return;

  const img = new Image();
  img.onload = async () => {
    if (!map.value || !overlayObject.overlay) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    if (overlayObject.whitePixelsHidden) {

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        // check if the pixel is a gray shade (which is likely a background pixel)
        if (r === g && g === b && alpha > 0) {
          data[i + 3] = 0; // makes the pixel transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const updatedImageUrl = canvas.toDataURL();

      // Remplacer l'overlay actuel avec l'image modifiée
      map.value.removeLayer(overlayObject.overlay);
      await createOverlay(updatedImageUrl, overlayObject);

    } else if (overlayObject.imageUrl) {
      // Restaurer l'image originale
      map.value.removeLayer(overlayObject.overlay);
      await createOverlay(overlayObject.imageUrl, overlayObject);
    }

    toast.add({
      severity: 'info',
      summary: overlayObject.whitePixelsHidden ? 'Background pixels have been hidden' : 'Background pixels are now visible',
      life: 2000
    });
  };

  // Processing with the original image URL
  img.src = overlayObject.whitePixelsHidden ?
    (overlayObject.imageUrl || (overlayObject.overlay as any).getElement().src) :
    (overlayObject.overlay as any).getElement().src;
}

function clearIndexedDB() {
  if (!db) return;

  const transactionOverlays = db.transaction('overlays', 'readwrite');
  const storeOverlays = transactionOverlays.objectStore('overlays');
  storeOverlays.clear();

  const transactionMapPosition = db.transaction('mapPosition', 'readwrite');
  const storeMapPosition = transactionMapPosition.objectStore('mapPosition');
  storeMapPosition.clear();

  alert('IndexedDB cleared!');
}

function resetImageRatio() {
  if (!idSelectedOverlay.value) {
    toast.add({
      severity: 'warn',
      summary: 'No image selected',
      detail: 'Please select an image first',
      life: 3000
    });
    return;
  }

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  // Create a new image to get the natural dimensions
  const img = new Image();
  img.onload = () => {
    if (!overlayObject.overlay || !map.value) return;

    // Get current corners and center point
    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners || currentCorners.length !== 4) return;

    // Calculate the center of the current image
    const center = {
      lat: (currentCorners[0].lat + currentCorners[2].lat) / 2,
      lng: (currentCorners[0].lng + currentCorners[2].lng) / 2
    };

    // Calculate current width and height in pixels
    const bounds = overlayObject.overlay.getBounds();
    const northEast = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const southWest = map.value.latLngToContainerPoint(bounds.getSouthWest());
    const currentWidthPx = Math.abs(northEast.x - southWest.x);
    const currentHeightPx = Math.abs(northEast.y - southWest.y);

    // Calculate the aspect ratio of the original image
    const originalRatio = img.naturalWidth / img.naturalHeight;

    // Determine whether to adjust width or height based on current dimensions
    let newWidth: number, newHeight: numer;
    if (currentWidthPx / currentHeightPx > originalRatio) {
      // Current image is too wide, adjust width based on height
      newHeight = currentHeightPx;
      newWidth = newHeight * originalRatio;
    } else {
      // Current image is too tall, adjust height based on width
      newWidth = currentWidthPx;
      newHeight = newWidth / originalRatio;
    }

    // Convert back to geo coordinates
    const centerPoint = map.value.latLngToContainerPoint(center);
    const halfWidth = newWidth / 2;
    const halfHeight = newHeight / 2;

    // Create new corner points - IMPORTANT: En inversant les deux coins du bas pour corriger l'orientation
    const newCorners = [
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y - halfHeight]), // top-left
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y - halfHeight]), // top-right
      map.value.containerPointToLatLng([centerPoint.x - halfWidth, centerPoint.y + halfHeight]), // bottom-left
      map.value.containerPointToLatLng([centerPoint.x + halfWidth, centerPoint.y + halfHeight])  // bottom-right
    ];

    // Apply the new corners
    overlayObject.overlay.setCorners(newCorners);

    // Save the changes to history
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    saveImageAndPosition();

    toast.add({
      severity: 'success',
      summary: 'Image ratio reset',
      detail: 'The image proportions have been restored',
      life: 3000
    });
  };

  // Get the original image URL
  img.src = overlayObject.imageUrl ||
    (overlayObject.overlay.getElement() as HTMLImageElement).src;
}

function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject || !overlayObject.overlay) return;

  const projectName = overlayObject.info?.projectName || 'No Project Name';
  overlayObject.overlay.bindTooltip(projectName, { permanent: true, direction: 'top' }).openTooltip();
}

// For a complete fix, we need to create a function that disables Leaflet's built-in keyboard handlers
function disableLeafletKeyboardEvents() {
  // Disable keyboard events on map container
  if (!map.value) {
    console.error('Map is not initialized yet!');
    return;
  }
  // Remove keyboard handlers from map so that arrow keys don't move the map
  map.value.keyboard.disable();

  // Add event listeners to prevent key events from propagating to Leaflet
  const mapContainer = map.value.getContainer();
  if (!mapContainer) {
    console.error('Map container not found!');
    return;
  }
  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    mapContainer.addEventListener(eventType, (e: KeyboardEvent) => {
      e.stopPropagation();
    }, true);
  });
}

</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
