<template>
  <Teleport to="body">
    <div
      v-if="hoverPreview && !suppress"
      ref="cardEl"
      class="hover-preview-card pointer-events-none fixed z-9999 bg-content-background rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.14),0_1px_4px_rgba(0,0,0,0.06)] px-3 py-2 flex flex-col gap-1 max-w-56"
    >
      <!-- Cluster tooltip -->
      <template v-if="hoverPreview.type === 'cluster'">
        <!-- Tag filter active: break the count down per filtered tag -->
        <template v-if="sortedTagCounts.length > 0">
          <span v-if="hoverPreview.name" class="text-sm font-semibold leading-snug text-color">
            {{ hoverPreview.name }}
          </span>
          <div class="flex flex-col gap-1 mt-0.5">
            <div
              v-for="tc in sortedTagCounts"
              :key="tc.tag"
              class="flex items-center justify-between gap-3"
            >
              <span
                class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full"
                :style="tagChipStyle(tc.tag)"
              >
                {{ tagLabel(tc.tag) }}
              </span>
              <span class="text-sm font-semibold text-color tabular-nums">{{ tc.count }}</span>
            </div>
          </div>
        </template>
        <!-- No tag filter: plain cluster count -->
        <template v-else>
          <span v-if="hoverPreview.name" class="text-sm font-semibold leading-snug text-color">
            {{ hoverPreview.name }}
            <span class="font-normal text-muted-color">{{
              $t("map.clusterProjectsPlus", { count: hoverPreview.count - 1 })
            }}</span>
          </span>
          <span v-else class="text-sm font-medium text-color">
            {{ $t("map.clusterProjects", { count: hoverPreview.count }) }}
          </span>
        </template>
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
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { hoverPreview, hoverPreviewX, hoverPreviewY } from "@/services/map/hoverPreviewState";
import { PROJECT_TAG_MAP } from "@/constants/projectTags";
import { UNTAGGED_PROJECT_FILTER } from "@/services/core/filters";
import LinePreview from "@/components/common/LinePreview.vue";
import { useFocusStore } from "@/stores/focusStore";

const { te: $te, t: $t } = useI18n();
const focusStore = useFocusStore();

// Suppress when a persistent detail panel is already open for the hovered project
const suppress = computed(() => {
  const preview = hoverPreview.value;
  if (!preview || preview.type !== "project") return false;
  return focusStore.selectedProjectId === preview.projectId;
});

// Cluster tag breakdown ordered by descending count, so the chip listed first matches the cluster
// dot's color (which takes the most numerous selected tag). toSorted keeps the selection order for
// ties since the underlying sort is stable.
const sortedTagCounts = computed(() => {
  const preview = hoverPreview.value;
  if (!preview || preview.type !== "cluster" || !preview.tagCounts) return [];
  return preview.tagCounts.toSorted((a, b) => b.count - a.count);
});

const DEFAULT_TAG_COLOR = "#6b7280";

function tagChipStyle(slug: string): Record<string, string> {
  const tag = PROJECT_TAG_MAP.get(slug);
  if (!tag) return { backgroundColor: DEFAULT_TAG_COLOR, color: "#ffffff" };
  return { backgroundColor: tag.color, color: tag.textColor };
}

// Localized label for a cluster breakdown chip: a tag slug, or the untagged sentinel.
function tagLabel(slug: string): string {
  if (slug === UNTAGGED_PROJECT_FILTER) return $t("map.controls.untagged");
  return $te(`tags.${slug}`) ? $t(`tags.${slug}`) : slug;
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

// Card dimensions only change when the content changes, so cache them and re-measure
// solely on content updates. Reading offsetWidth/offsetHeight forces a synchronous reflow,
// which would otherwise run on every cursor move (mousemove fires up to 500x/sec).
let measuredW = CARD_W;
let measuredH = CARD_H;

function positionCard(): void {
  const el = cardEl.value;
  if (!el) return;
  const x = hoverPreviewX.value;
  const y = hoverPreviewY.value;

  // Base safe area on the viewport by default
  let minX = EDGE_GAP;
  let maxX = window.innerWidth - EDGE_GAP;
  let minY = EDGE_GAP;
  let maxY = window.innerHeight - EDGE_GAP;

  // Constrain to the map div so the card never spills onto the surrounding page, but only by
  // EDGE_GAP. A larger inset would shove edge-anchored cards far toward the center; at the edge the
  // card should sit offset by just half its width plus EDGE_GAP from the cursor.
  const mapDiv = document.getElementById("mapDiv");
  if (mapDiv) {
    const rect = mapDiv.getBoundingClientRect();
    minX = rect.left + EDGE_GAP;
    maxX = rect.right - EDGE_GAP;
    minY = rect.top + EDGE_GAP;
    maxY = rect.bottom - EDGE_GAP;
  }

  // Anchor the card horizontally centered on x, but clamp to safe bounds
  const left = Math.max(minX, Math.min(x - measuredW / 2, maxX - measuredW));

  // Anchor the card vertically OFFSET below y, or above if it hits the bottom
  let top = y + OFFSET;
  if (top + measuredH > maxY) {
    top = y - OFFSET - measuredH;
  }
  // Clamp top to safe bounds just in case it's still out (e.g. if y was extremely high)
  top = Math.max(minY, Math.min(top, maxY - measuredH));

  el.style.display = "";
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function measureAndPositionCard(): void {
  const el = cardEl.value;
  if (!el) return;
  measuredW = el.offsetWidth || CARD_W;
  measuredH = el.offsetHeight || CARD_H;
  positionCard();
}

// Re-measure only when the card content changes, then reposition with the fresh size.
watch(hoverPreview, scheduleCardMeasurement, { immediate: true });

function scheduleCardMeasurement(): void {
  void nextTick().then(measureAndPositionCard);
}

// Cursor moves reposition using the cached size, so no reflow on the per-move path.
watchEffect(positionCard);
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
