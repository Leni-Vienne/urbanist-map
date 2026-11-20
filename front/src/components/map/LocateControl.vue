<template>
  <button
    type="button"
    class="size-full flex items-center justify-center rounded-r-[5px] border-l border-content-border-color cursor-pointer transition-colors hover:bg-(--p-content-hover-background) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-color disabled:opacity-40 disabled:cursor-wait"
    :class="
      locationState === 'active' ? 'bg-primary-color/10 text-primary-color' : 'text-muted-color'
    "
    :disabled="isLocating"
    :aria-busy="isLocating"
    :aria-label="label"
    v-tooltip.bottom="{ value: label, disabled: isMobile }"
    @click.stop="handleClick"
    @dblclick.stop
  >
    <i v-if="isLocating" class="pi pi-spinner pi-spin" aria-hidden="true"></i>
    <LocateOff v-else-if="permissionState === 'denied'" :size="18" aria-hidden="true" />
    <Locate v-else :size="18" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onWatcherCleanup, ref, watch } from "vue";
import Locate from "@lucide/vue/dist/esm/icons/locate.mjs";
import LocateOff from "@lucide/vue/dist/esm/icons/locate-off.mjs";
import { GeolocateControl, type GeolocateErrorEvent, type Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { getMapOrNull } from "@/services/core/map";
import { resolveMapPadding } from "@/services/core/mapNavigation";
import { toastError } from "@/services/core/toast";
import { isMobile } from "@/services/core/viewport";

const { t } = useI18n();
const locationState = ref<"idle" | "locating" | "active" | "background">("idle");
const controlRevision = ref(0);
const isLocating = computed(() => locationState.value === "locating");
const permissionState = ref<PermissionState>("prompt");
const label = computed(() => {
  if (!globalThis.isSecureContext) return t("map.location.secureContext");
  if (permissionState.value === "denied") return t("map.location.blocked");
  if (locationState.value === "locating") return t("map.location.locating");
  if (locationState.value === "active") return t("map.location.hide");
  if (locationState.value === "background") return t("map.location.recenter");
  return t("map.location.label");
});
let control: GeolocateControl | null = null;
let permissionStatus: PermissionStatus | null = null;
let disposed = false;

function handleClick(): void {
  if (!globalThis.isSecureContext) {
    toastError(t("map.location.secureContext"));
    return;
  }
  if (permissionState.value === "denied") {
    toastError(t("map.location.blocked"));
    return;
  }
  if (!navigator.geolocation) {
    toastError(t("map.location.unsupported"));
    return;
  }
  if (!control?.trigger()) toastError(t("map.location.starting"));
}

function attachControl([target]: [MaplibreMap | null, number]): void {
  if (!target) return;
  const map = target;
  const next = new GeolocateControl({
    trackUserLocation: false,
    positionOptions: { maximumAge: 30_000, timeout: 5000 },
    fitBoundsOptions: {
      animate: false,
      maxZoom: 16,
      absolutePadding: true,
      get padding() {
        return resolveMapPadding();
      },
    },
  });
  next.on("trackuserlocationstart", startLocating);
  next.on("trackuserlocationend", stopTracking);
  next.on("userlocationfocus", showTracking);
  next.on("userlocationlostfocus", showBackgroundTracking);
  next.on("geolocate", finishLocating);
  next.on("outofmaxbounds", showUnavailable);
  next.on("error", handleError);
  map.addControl(next);
  control = next;

  onWatcherCleanup(detachControl);

  function detachControl(): void {
    if (map.hasControl(next)) map.removeControl(next);
    control = null;
    locationState.value = "idle";
  }
}

function startLocating(): void {
  if (locationState.value === "idle") locationState.value = "locating";
}

function stopTracking(): void {
  locationState.value = "idle";
}

function showTracking(): void {
  locationState.value = "active";
}

function showBackgroundTracking(): void {
  locationState.value = "background";
}

function finishLocating(): void {
  if (locationState.value === "locating") showTracking();
}

function showUnavailable(): void {
  reportLocationError("map.location.unavailable");
}

function handleError({ code }: GeolocateErrorEvent): void {
  switch (code) {
    case GeolocationPositionError.PERMISSION_DENIED:
      stopTracking();
      // The next permission request starts with a fresh control instance.
      controlRevision.value += 1;
      toastError(t("map.location.blocked"));
      break;
    case GeolocationPositionError.TIMEOUT:
      reportLocationError("map.location.timeout");
      break;
    default:
      showUnavailable();
  }
}

function reportLocationError(message: "map.location.timeout" | "map.location.unavailable"): void {
  if (isLocating.value) {
    // End the failed watch so the next press requests a fresh fix.
    control?.trigger();
    toastError(t(message));
  }
}

function syncPermission(): void {
  if (permissionStatus) permissionState.value = permissionStatus.state;
}

async function observePermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (disposed) return;
    permissionStatus = status;
    syncPermission();
    status.addEventListener("change", syncPermission);
  } catch {
    // Some browsers support geolocation without a queryable permission.
  }
}

function stopObservingPermission(): void {
  disposed = true;
  permissionStatus?.removeEventListener("change", syncPermission);
}

watch([getMapOrNull, controlRevision], attachControl, { immediate: true });
onMounted(observePermission);
onBeforeUnmount(stopObservingPermission);
</script>
