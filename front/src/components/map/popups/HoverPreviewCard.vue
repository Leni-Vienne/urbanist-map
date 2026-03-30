<template>
  <Teleport to="body">
    <div
      v-if="hoverPreview && !suppress"
      ref="cardEl"
      class="hover-preview-card pointer-events-none fixed z-9999 bg-content-background rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.14),0_1px_4px_rgba(0,0,0,0.06)] px-3 py-2 flex flex-col gap-1 max-w-56"
    >
      <!-- Cluster tooltip -->
      <template v-if="hoverPreview.type === 'cluster'">
        <span class="text-sm font-medium text-color">
          {{ $t("map.clusterProjects", { count: hoverPreview.count }) }}
        </span>
      </template>

      <!-- Single project preview -->
      <template v-else>
        <!-- Spinner while project data is loading -->
        <div v-if="!hoverPreview.project" class="flex items-center gap-2">
          <i class="pi pi-spin pi-spinner text-muted-color text-xs"></i>
          <span class="text-xs text-muted-color">{{ $t("common.loading") }}</span>
        </div>
        <template v-else>
          <!-- Project name -->
          <span
            class="text-sm font-semibold leading-snug"
            :class="hoverPreview.project.name ? 'text-color' : 'text-muted-color italic'"
          >
            {{ hoverPreview.project.name || $t("project.unnamed") }}
          </span>
          <!-- Timeline status row -->
          <div class="flex items-center gap-1.5">
            <span
              class="w-2 h-2 rounded-full inline-block shrink-0"
              :style="{ backgroundColor: statusColor }"
            ></span>
            <span class="text-xs text-muted-color">
              {{
                $te(`timelineStatus.${hoverPreview.project.timelineStatus}`)
                  ? $t(`timelineStatus.${hoverPreview.project.timelineStatus}`)
                  : hoverPreview.project.timelineStatus
              }}
            </span>
          </div>
        </template>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { hoverPreview, hoverPreviewX, hoverPreviewY } from "@/services/map/hoverPreviewState";
import { getTimelineStatusColor } from "@/utils/markerColors";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import type { TimelineStatus } from "../../../../../back/src/db/schema";

const { te: $te, t: $t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const { projectInfoPopup } = storeToRefs(uiStore);
const { showInfoPopup, infoPopupOverlayId, overlays } = storeToRefs(overlayStore);

// Suppress when a persistent popup is already open for the hovered project
const suppress = computed(() => {
  const preview = hoverPreview.value;
  if (!preview || preview.type !== "project") return false;
  if (projectInfoPopup.value.visible && projectInfoPopup.value.projectId === preview.projectId)
    return true;
  if (showInfoPopup.value && infoPopupOverlayId.value) {
    const overlay = overlays.value[infoPopupOverlayId.value];
    if (overlay?.projectId === preview.projectId) return true;
  }
  return false;
});

// Map MarkerColor keys to CSS colour values (mirrors ProjectMetadataCard)
const colorMap: Record<string, string> = {
  yellow: "#eab308",
  blue: "#3b82f6",
  orange: "#f97316",
  green: "#22c55e",
  grey: "#9ca3af",
  red: "#ef4444",
};

const statusColor = computed(() => {
  if (hoverPreview.value?.type !== "project" || !hoverPreview.value.project) return "transparent";
  const key = getTimelineStatusColor(
    hoverPreview.value.project.timelineStatus as TimelineStatus | null,
  );
  return colorMap[key] ?? "#9ca3af";
});

// Position the card near the cursor with a small offset.
// Updated imperatively via watchEffect so mousemove position changes never trigger a re-render.
// Flips to the opposite side when near an edge, keeping a small gap from the viewport boundary.
const OFFSET = 16;
const EDGE_GAP = 6;
const CARD_W = 224; // max-w-56 = 14rem = 224px
const CARD_H = 64; // approximate height

const cardEl = ref<HTMLElement | null>(null);

watchEffect(() => {
  const el = cardEl.value;
  if (!el) return;
  const x = hoverPreviewX.value;
  const y = hoverPreviewY.value;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = x + OFFSET + CARD_W > vw ? vw - CARD_W - EDGE_GAP : x + OFFSET;
  const top = y + OFFSET + CARD_H > vh ? vh - CARD_H - EDGE_GAP : y + OFFSET;
  el.style.display = "";
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
});
</script>

<style scoped>
.hover-preview-card {
  animation: hover-card-in 0.12s ease-out both;
}

@keyframes hover-card-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
