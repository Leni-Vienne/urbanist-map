<template>
  <button
    v-if="isVisible"
    type="button"
    class="w-9 h-9 flex items-center justify-center rounded-lg border border-surface bg-content-background/95 backdrop-blur-sm shadow-[0_2px_8px_rgba(0,0,0,0.2)] text-color cursor-pointer transition-colors hover:bg-content-hover-background pointer-events-auto"
    :aria-label="t('map.resetNorth')"
    :title="t('map.resetNorth')"
    @click.stop="resetNorth"
    @dblclick.stop
  >
    <CompassRose :size="24" :style="{ transform: `rotate(${-currentBearing}deg)` }" />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CompassRose from "@/components/map/CompassRose.vue";
import { map, currentBearing, currentPitch } from "@/services/core/map";
import { mapRotationEnabled } from "@/composables/core/useMapRotation";

const { t } = useI18n();

// Only surface the compass when rotation is enabled and the camera is off its default
// north-up orientation, so the button stays out of the way when there's nothing to reset.
const isVisible = computed(
  () =>
    mapRotationEnabled.value && (Math.abs(currentBearing.value) > 0.5 || currentPitch.value > 0.5),
);

function resetNorth() {
  map.value.resetNorthPitch();
}
</script>
