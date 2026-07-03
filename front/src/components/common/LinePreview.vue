<template>
  <!-- Dashed line preview matching the map stroke style for a project's timeline status -->
  <svg width="28" height="10" class="shrink-0" :aria-hidden="title ? undefined : 'true'">
    <!-- :title doesn't work in SVG, <title> is the SVG-native tooltip/label -->
    <title v-if="title">{{ title }}</title>
    <line
      x1="0"
      y1="5"
      x2="28"
      y2="5"
      :stroke="color"
      stroke-width="2.5"
      :stroke-dasharray="STATUS_PREVIEW_DASHARRAY[status] ?? ''"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
import { STATUS_PREVIEW_DASHARRAY } from "@/services/map/shapes/styleConstants";

defineProps<{
  // A TimelineStatus value; unknown statuses render solid.
  status: string;
  color: string;
  title?: string;
}>();
</script>
