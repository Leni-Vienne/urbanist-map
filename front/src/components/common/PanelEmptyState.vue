<template>
  <div
    class="flex flex-col items-center justify-center p-12 text-center text-[var(--p-surface-600)] h-full"
  >
    <i :class="['pi', iconClass, 'text-5xl text-[var(--p-surface-400)] mb-4']"></i>
    <p class="text-base font-medium mb-2 text-[var(--p-surface-600)]">{{ message }}</p>
    <p v-if="subMessage" class="text-sm text-[var(--p-surface-500)]">{{ subMessage }}</p>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

// AI : Props for customizing the empty state
interface Props {
  icon?: string;
  message: string;
  subMessage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  icon: "folder",
});

// AI : Compute full icon class
const iconClass = computed(() => `pi-${props.icon}`);
</script>
