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
      <div class="card flex justify-center">
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
          <Button @click="removeWhitePixels">Remove White Pixels</Button>
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
  imageUrl?: string;
  corners: { lat: number, lng: number }[];
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  info: info | null;
}

export type info = {
  projectName: string;
  address: string;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
}

// Type complet pour l'utilisation pendant l'exécution
export type overlayObject = StoredOverlayData & {
  overlay: L.ImageOverlay;
  marker: L.Marker;
  alreadyLoaded: boolean; // Track if the overlay is already loaded in the page
  alreadyStored: boolean; // Track if the overlay is already stored in IndexedDB
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
    value: overlayObject;
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
  const savedPosition = await getSavedMapPosition();
  const initialView = savedPosition || { center: [48.845, 2.424], zoom: 10 };

  map.value = L.map("viewerDiv").setView(initialView.center, initialView.zoom);
  if (!map.value) throw new Error('No map element found');

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
      html: '<span class="pi pi-undo"></span>',
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
      html: '<i class="pi pi-redo"></i>',
      tooltip: 'Redo',
    },
  },
  addHooks: function () {
    redo();
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
            html: `<div id="info-popup-container"></div>`,
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
      setTimeout(() => {
        this.options.subToolbar._hide();
      }, 100);
    } else {
      L.DomUtil.addClass(link, "subtoolbar_enabled");

      setTimeout(() => {
        console.log("ici")
        if (!idSelectedOverlay.value) return;

        const popupElement = document.getElementsByClassName("more-info-popup")[0];

        if (!popupElement || popupElement.tagName !== 'A') {
          console.log("dans return")
          return
        }
        const newDiv = document.createElement('div');
        newDiv.className = "leaflet-toolbar-icon more-info-popup";
        newDiv.id = "info-popup-container";
        if (popupElement.parentNode) {
          popupElement.parentNode.replaceChild(newDiv, popupElement);
        } else {
          console.log("popupElement.parentNode is null !! ")
          return
        }

        // 2. Créer et monter le vnode InfoPopup
        const vnode = createVNode(InfoPopup, {
          overlayObject: overlays.value[idSelectedOverlay.value],
          onProjectSubmit: handleProjectSubmit
        });
        vnode.appContext = app?.appContext ?? null;
        render(vnode, newDiv);
      }, 10);
    }

    L.IconUtil.toggleXlink(link, "information", "close");
    L.IconUtil.toggleTitle(link, "Close", "About");
  }
});

// Function to handle project data submitted from InfoPopup
function handleProjectSubmit(projectInfo: info & { id: string }) {
  console.log('Project data received:', projectInfo);

  // Update the overlay with project information
  if (projectInfo.id && overlays.value[projectInfo.id]) {
    // Store project information in the overlay object
    const overlay = overlays.value[projectInfo.id];
    overlay.info = {
      projectName: projectInfo.projectName,
      address: projectInfo.address,
      startDate: projectInfo.startDate,
      endDate: projectInfo.endDate,
      budget: projectInfo.budget
    };

    // Update tooltip text with project name
    toast.add({ severity: 'success', summary: 'Success', detail: 'Message Content', life: 3000 });

    // Save to IndexedDB
    saveImageAndPosition();

    // Close the info popup (optional)
    const infoLink = document.querySelector('.pi-info-circle');
    if (infoLink) {
      infoLink.click();
    }
  }
}

// all actions (not all in docs) : L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.DeleteAction, L.StackAction, L.EditAction, L.RotateAction, L.ScaleAction, L.TranslateAction, L.OpacitiesAction, L.GeolocateAction, L.RestoreAction, L.UnlockAction
// L.EditAction is empty
// L.TranslateAction crashes
// L.UnlockAction is useless
// L.GeolocateAction crashes "ReferenceError: EXIF is not defined"
// L.RestoreAction undistorts the image
// L.OpacitiesAction works well!
const editTools = [undoTool, redoTool, L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.OpacitiesAction, L.DeleteAction, L.StackAction]
const viewTools = [centerTool, L.OpacityAction, L.OpacitiesAction, L.StackAction]


async function createOverlay(imageUrl: string, overlayObject?: overlayObject) {
  if (!map.value || !overlayObject) return null;

  const newOverlay = L.distortableImageOverlay(imageUrl, {
    editable: true,
    tooltipText: overlayObject.info?.projectName,
    keyboard: false,
    actions: [
      infoTool,
      undoTool,
      redoTool,
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
  L.DomEvent.on(newOverlay.getElement(), 'load', () => {
    if (overlayObject.alreadyStored || overlayObject.alreadyLoaded) {
      overlayObject.overlay.setCorners(overlayObject.history.at(-1));
    }

    if (!overlayObject.alreadyLoaded) {
      saveToHistory(overlayObject);
      overlayObject.marker = createMarker(overlayObject);
    }

    overlayObject.alreadyLoaded = true
    overlayObject.alreadyStored = true
  });
  return newOverlay;
}

function createMarker(overlayObject: overlayObject) {
  if (!map.value) return null;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  const marker = L.marker(center).addTo(map.value);
  return marker;
}

function updateMarkerPosition(overlayObject: overlayObject) {
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

async function saveImageAndPosition() {
  if (!db) return;

  // Créer un tableau de StoredOverlayData à partir des overlayObject
  const savedOverlays: StoredOverlayData[] = Object.values(overlays.value).map(overlayObj => ({
    id: overlayObj.id,
    imageUrl: overlayObj.overlay?.getElement()?.src,
    corners: overlayObj.overlay?.getCorners() || [],
    history: overlayObj.history,
    redoStack: overlayObj.redoStack,
    info: overlayObj.info || {
      projectName: '',
      address: '',
      startDate: null,
      endDate: null,
      budget: 0
    }
  }));

  await saveOverlaysToDB(savedOverlays);
}

async function saveOverlaysToDB(overlays: StoredOverlayData[]) {
  if (!db) return;
  const transaction = db.transaction('overlays', 'readwrite');
  const store = transaction.objectStore('overlays');
  for (const overlay of overlays) {
    await store.put(overlay);
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
      address: '',
      startDate: null,
      endDate: null,
      budget: 0
    }
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
  overlay.setCorners(previousState);

  updateMarkerPosition(overlayObject);
}

function redo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (redoStack.length === 0) return;

  const nextState = redoStack.pop()!;
  history.push(nextState);

  overlay.setCorners(nextState);

  updateMarkerPosition(overlayObject);
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  // adding and removing tools is finicky (tools are often removed from the arrays) but this way works
  Object.values(overlays.value).forEach((overlayObject) => {
    const editing = overlayObject.overlay.editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }
  });
}

async function removeWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { overlay } = overlayObject;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !map.value) return;

  const img = new Image();
  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];

      // Check if the pixel has the same red, green, and blue values
      if (r === g && g === b && alpha > 0) {
        data[i + 3] = 0; // Set alpha to 0 (make pixel transparent)
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const updatedImageUrl = canvas.toDataURL();

    map.value.removeLayer(overlay);
    await createOverlay(updatedImageUrl, overlayObject);
  };
  img.src = overlay.getElement().src; // what is actually updating the image
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

function updateTooltipText() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  overlayObject.overlay.bindTooltip(overlayObject.info?.projectName, { permanent: true, direction: 'top' }).openTooltip();
}

// For a complete fix, we need to create a function that disables Leaflet's built-in keyboard handlers
function disableLeafletKeyboardEvents() {
  // Disable keyboard events on map container
  if (map.value) {
    // Remove keyboard handlers from map
    map.value.keyboard.disable();

    // Add event listeners to prevent key events from propagating to Leaflet
    const mapContainer = map.value.getContainer();
    if (mapContainer) {
      ['keydown', 'keyup', 'keypress'].forEach(eventType => {
        mapContainer.addEventListener(eventType, (e) => {
          e.stopPropagation();
        }, true);
      });
    }
  }

  // Disable keyboard events on all image overlays
  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.overlay && overlayObject.overlay.editing) {
      // Disable any keyboard handlers in the editing instance
      if (overlayObject.overlay.editing._disableKeyboard) {
        overlayObject.overlay.editing._disableKeyboard();
      }

      // If the overlay has an element, prevent keyboard events on it
      const element = overlayObject.overlay.getElement();
      if (element) {
        ['keydown', 'keyup', 'keypress'].forEach(eventType => {
          element.addEventListener(eventType, (e) => {
            e.stopPropagation();
          }, true);
        });
      }
    }
  });
}

</script>

<style scoped>
header {
  line-height: 1.5;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

@media (min-width: 1024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }
}

.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#viewerDiv {
  width: 100%;
  height: 100%;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
