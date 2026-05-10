<template>
  <div
    class="flex flex-col items-center justify-center p-12 text-center text-(--p-text-color-secondary) h-full"
  >
    <i :class="['pi', iconClass, 'text-5xl text-muted-color mb-4']"></i>
    <p class="text-base font-medium mb-2 text-(--p-text-color-secondary)">
      {{ message }}
    </p>
    <p v-if="subMessage" class="text-sm text-muted-color">
      {{ subMessage }}
    </p>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  icon?: string;
  message: string;
  subMessage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  icon: "folder",
});

const iconClass = computed(() => `pi-${props.icon}`);
</script>
