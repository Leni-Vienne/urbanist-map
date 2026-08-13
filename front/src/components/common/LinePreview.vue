<template>
  <!-- Dashed line preview matching the map stroke style for a project's timeline status -->
  <svg width="28" height="10" class="shrink-0" aria-hidden="true">
    <line
      x1="0"
      y1="5"
      x2="28"
      y2="5"
      :stroke="color"
      stroke-width="2.5"
      :stroke-dasharray="status ? STATUS_PREVIEW_DASHARRAY[status] : ''"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
import { STATUS_PREVIEW_DASHARRAY } from "@/services/map/shapes/styleConstants";
import type { TimelineStatus } from "../../../../back/src/db/schema";

defineProps<{
  // Null renders solid.
  status: TimelineStatus | null;
  color: string;
}>();
</script>
