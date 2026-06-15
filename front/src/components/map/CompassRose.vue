<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" class="block">
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      opacity="0.8"
    />
    <polygon points="12,2.5 8,12 16,12" fill="#ef4444" />
    <polygon points="12,21.5 8,12 16,12" fill="currentColor" opacity="0.6" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string }>(), { size: 20 });
</script>
