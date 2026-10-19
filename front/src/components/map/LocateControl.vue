<template>
  <button
    type="button"
    class="w-9 h-9 flex items-center justify-center cursor-pointer transition-colors hover:bg-(--p-content-hover-background) disabled:opacity-40 disabled:cursor-wait"
    :class="locationState === 'active' ? 'bg-primary-color/10 text-primary-color' : 'text-color'"
    :disabled="isLocating"
    :aria-busy="isLocating"
    :aria-label="label"
    v-tooltip.left="{ value: label, disabled: isMobile }"
    @click.stop="handleClick"
    @dblclick.stop
  >
    <i v-if="isLocating" class="pi pi-spinner pi-spin" aria-hidden="true"></i>
    <NavigationOff
      v-else-if="locationState === 'disabled' || permissionState === 'denied'"
      :size="18"
      aria-hidden="true"
    />
    <Navigation
      v-else
      :size="18"
      :fill="locationState === 'active' ? 'currentColor' : 'none'"
      aria-hidden="true"
    />
  </button>

  <Teleport v-if="markerElement" :to="markerElement">
    <span
      class="block size-full rounded-full border-2 border-white bg-blue-500 ring-4 ring-blue-500/20 shadow-md"
      role="img"
      :aria-label="accuracyLabel"
      v-tooltip.top="{ value: accuracyLabel, disabled: isMobile }"
    ></span>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { Navigation, NavigationOff } from "@lucide/vue";
import { Marker, type Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { getMapOrNull, onMapReady } from "@/services/core/map";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { setShowUserLocation, showUserLocation } from "@/services/core/settings";
import { toastError } from "@/services/core/toast";
import { isMobile } from "@/services/core/viewport";
import { createLocationAccuracyOverlay } from "@/services/map/locationAccuracy";

const { t, locale } = useI18n();
const isLocating = ref(false);
// Navigation state lasts only for this visit; the saved opt-in restores the dot, not this styling.
const locationState = ref<"idle" | "active" | "disabled">("idle");
const markerElement = shallowRef<HTMLElement | null>(null);
const accuracyMeters = ref(0);
const accuracyLabel = computed(() => {
  const useKilometers = accuracyMeters.value >= 1000;
  const distance = new Intl.NumberFormat(locale.value, {
    style: "unit",
    unit: useKilometers ? "kilometer" : "meter",
    maximumFractionDigits: useKilometers ? 1 : 0,
  }).format(useKilometers ? accuracyMeters.value / 1000 : accuracyMeters.value);
  return t("map.location.accuracy", { distance });
});
const accuracyOverlay = createLocationAccuracyOverlay();
const permissionState = ref<PermissionState>("prompt");
const label = computed(() => {
  if (permissionState.value === "denied") return t("map.location.blocked");
  if (isLocating.value) return t("map.location.locating");
  return t(locationState.value === "active" ? "map.location.hide" : "map.location.label");
});
let marker: Marker | null = null;
let disposed = false;
let permissionStatus: PermissionStatus | null = null;
let stopWaitingForMap: (() => void) | null = null;
let requestId = 0;
let navigationMap: MaplibreMap | null = null;

function resetNavigationState(): void {
  if (locationState.value === "active") locationState.value = "idle";
}

function disableLocation(): void {
  // Turning location off also invalidates pending results and cancels its camera flight.
  requestId += 1;
  stopWaitingForMap?.();
  stopWaitingForMap = null;
  isLocating.value = false;
  if (locationState.value === "active") navigationMap?.stop();
  locationState.value = "disabled";
  marker?.remove();
  marker = null;
  markerElement.value = null;
  accuracyOverlay.clear();
  setShowUserLocation(false);
}

function syncPermission(): void {
  if (!permissionStatus) return;
  const previousState = permissionState.value;
  permissionState.value = permissionStatus.state;
  if (permissionStatus.state === "granted") return;
  if (permissionStatus.state === "prompt" && previousState !== "granted") return;
  disableLocation();
}

function handleClick(): void {
  if (locationState.value === "active") disableLocation();
  else locate(true);
}

async function initializePermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (disposed) return;
    permissionStatus = status;
    status.addEventListener("change", syncPermission);
    syncPermission();
    if (showUserLocation.value && status.state === "granted") {
      stopWaitingForMap = onMapReady(() => locate(false));
    }
  } catch {
    // Without permission inspection, keep location click-only to avoid prompting on a return visit.
  }
}

function locate(recenter: boolean): void {
  if (isLocating.value) return;
  if (permissionState.value === "denied") return;
  const map = getMapOrNull();
  if (!map) return;
  if (!navigator.geolocation) {
    toastError(t("map.location.unsupported"));
    return;
  }

  isLocating.value = true;
  requestId += 1;
  const currentRequest = requestId;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      // A permission prompt can outlive this view. Never update a removed or replacement map.
      if (disposed || currentRequest !== requestId || getMapOrNull() !== map) return;
      isLocating.value = false;
      locationState.value = "idle";
      setShowUserLocation(true);

      if (!marker) {
        const element = document.createElement("div");
        element.className = "size-4";
        markerElement.value = element;
        marker = new Marker({ element });
      }
      marker.setLngLat([coords.longitude, coords.latitude]).addTo(map);
      accuracyMeters.value = coords.accuracy;
      const bounds = accuracyOverlay.show(coords.longitude, coords.latitude, coords.accuracy);
      if (recenter) {
        if (!navigationMap) {
          navigationMap = map;
          map.on("movestart", resetNavigationState);
        }
        mobileAwareFlyToBounds(bounds, { maxZoom: 16 });
        // The flight starts synchronously. Later movements clear the active navigation styling.
        locationState.value = "active";
      }
    },
    (error) => {
      if (disposed || currentRequest !== requestId || getMapOrNull() !== map) return;
      isLocating.value = false;
      // Browsers also report a dismissed permission prompt as permission denied.
      if (error.code === error.PERMISSION_DENIED) {
        syncPermission();
        return;
      }
      if (!recenter) return;
      if (error.code === error.TIMEOUT) {
        toastError(t("map.location.timeout"));
      } else {
        toastError(t("map.location.unavailable"));
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  );
}

onMounted(() => {
  void initializePermission();
});

onBeforeUnmount(() => {
  disposed = true;
  permissionStatus?.removeEventListener("change", syncPermission);
  stopWaitingForMap?.();
  navigationMap?.off("movestart", resetNavigationState);
  marker?.remove();
  accuracyOverlay.dispose();
});
</script>
