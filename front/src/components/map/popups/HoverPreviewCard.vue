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
        <!-- Project name -->
        <span
          class="text-sm font-semibold leading-snug"
          :class="hoverPreview.data.name ? 'text-color' : 'text-muted-color italic'"
        >
          {{ hoverPreview.data.name || $t("project.unnamed") }}
        </span>
        <!-- Timeline status with dashed line preview matching the map vector style -->
        <div class="flex items-center gap-1.5">
          <LinePreview
            :status="hoverPreview.data.timelineStatus ?? ''"
            :color="firstTagColor(hoverPreview.data.tags[0])"
          />
          <span class="text-xs text-muted-color">
            {{
              $te(`timelineStatus.${hoverPreview.data.timelineStatus}`)
                ? $t(`timelineStatus.${hoverPreview.data.timelineStatus}`)
                : hoverPreview.data.timelineStatus
            }}
          </span>
        </div>
        <!-- Tags row -->
        <div v-if="hoverPreview.data.tags.length > 0" class="flex flex-wrap gap-1 mt-0.5">
          <span
            v-for="tag in hoverPreview.data.tags"
            :key="tag"
            class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full"
            :style="tagChipStyle(tag)"
          >
            {{ $te(`tags.${tag}`) ? $t(`tags.${tag}`) : tag }}
          </span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { hoverPreview, hoverPreviewX, hoverPreviewY } from "@/services/map/hoverPreviewState";
import { PROJECT_TAG_MAP } from "@/config/projectTags";
import LinePreview from "@/components/common/LinePreview.vue";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

const { te: $te, t: $t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const { projectDetail } = storeToRefs(uiStore);
const { overlayDetailVisible, overlayDetailId, overlays } = storeToRefs(overlayStore);

// Suppress when a persistent detail panel is already open for the hovered project
const suppress = computed(() => {
  const preview = hoverPreview.value;
  if (!preview || preview.type !== "project") return false;
  if (projectDetail.value.visible && projectDetail.value.projectId === preview.projectId)
    return true;
  if (overlayDetailVisible.value && overlayDetailId.value) {
    const overlay = overlays.value[overlayDetailId.value];
    if (overlay?.projectId === preview.projectId) return true;
  }
  return false;
});

const DEFAULT_TAG_COLOR = "#6b7280";

function tagChipStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: DEFAULT_TAG_COLOR, color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

function firstTagColor(slug: string | undefined): string {
  return PROJECT_TAG_MAP.get(slug ?? "")?.color ?? DEFAULT_TAG_COLOR;
}

// Position the card centered horizontally under the cursor.
// Updated imperatively via watchEffect so mousemove position changes never trigger a re-render.
// Clamps to the viewport horizontally and flips above the cursor when near the bottom edge.
const OFFSET = 16;
const EDGE_GAP = 6;
const CARD_W = 224; // max-w-56 = 14rem = 224px, used as a fallback before first measure
const CARD_H = 90; // approximate height, used as a fallback before first measure

const cardEl = ref<HTMLElement | null>(null);

watchEffect(() => {
  const el = cardEl.value;
  if (!el) return;
  const x = hoverPreviewX.value;
  const y = hoverPreviewY.value;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth || CARD_W;
  const h = el.offsetHeight || CARD_H;
  const left = Math.max(EDGE_GAP, Math.min(x - w / 2, vw - w - EDGE_GAP));
  const top = y + OFFSET + h + EDGE_GAP > vh ? y - OFFSET - h : y + OFFSET;
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
