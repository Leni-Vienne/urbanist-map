<template>
  <svg class="w-0 h-0 absolute overflow-hidden" aria-hidden="true">
    <defs>
      <!-- Generate gradients for each marker color -->
      <template v-for="color in Object.keys(markerColors)" :key="color">
        <!-- Body Gradient -->
        <linearGradient :id="`g-${color}`" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" :stop-color="getLightColor(color)" />
          <stop offset="55%" :stop-color="getBaseColor(color)" />
          <stop offset="100%" :stop-color="getDarkColor(color)" />
        </linearGradient>

        <!-- Shadow Gradient (only needs one really, but keeping per-color pattern for now to match logic) -->
        <linearGradient :id="`shadow-grad-${color}`" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.35" />
          <stop offset="100%" stop-color="black" stop-opacity="0" />
        </linearGradient>

        <!-- Standalone Project variants (same logic, just different IDs for safety) -->
        <linearGradient :id="`g-${color}-standalone`" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" :stop-color="getLightColor(color)" />
          <stop offset="55%" :stop-color="getBaseColor(color)" />
          <stop offset="100%" :stop-color="getDarkColor(color)" />
        </linearGradient>

        <linearGradient :id="`shadow-grad-${color}-standalone`" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.35" />
          <stop offset="100%" stop-color="black" stop-opacity="0" />
        </linearGradient>
      </template>
    </defs>
  </svg>
</template>

<script setup lang="ts">
import { markerColors } from "@/services/map/markersSvg";

function getBaseColor(colorKey: string): string {
  return markerColors[colorKey as keyof typeof markerColors];
}

function lightenColor(color: string, amount: number): string {
  const hex = color.slice(1);
  const num = Number.parseInt(hex, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0x00_ff) + amount;
  let b = (num & 0x00_00_ff) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function darkenColor(color: string, amount: number): string {
  return lightenColor(color, -amount);
}

function getLightColor(colorKey: string): string {
  return lightenColor(getBaseColor(colorKey), 40);
}

function getDarkColor(colorKey: string): string {
  return darkenColor(getBaseColor(colorKey), 40);
}
</script>
