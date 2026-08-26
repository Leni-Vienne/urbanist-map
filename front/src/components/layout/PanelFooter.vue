<template>
  <div
    class="shrink-0 bg-content-background border-t border-surface flex justify-center items-center gap-2"
    :class="
      compact
        ? 'pt-[0.2rem] pb-[calc(0.2rem+env(safe-area-inset-bottom))] px-4'
        : 'pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] px-2'
    "
  >
    <a href="/legal" :class="linkClass">{{ $t("footer.legal") }}</a>
    <span class="text-muted-color" :class="textSizeClass">•</span>
    <a href="/contact" :class="linkClass">{{ $t("common.contact") }}</a>
    <span class="text-muted-color" :class="textSizeClass">•</span>
    <a
      href="https://github.com/Leni-Vienne/urbanist-map"
      target="_blank"
      rel="noopener noreferrer"
      class="group inline-flex items-center gap-1 text-(--p-text-color-secondary) transition-all duration-150 hover:text-primary-color"
      :class="textSizeClass"
    >
      <i class="pi pi-github" :class="textSizeClass"></i>
      <span
        class="underline underline-offset-2 decoration-(--p-text-muted-color) group-hover:decoration-primary-color"
        >{{ $t("footer.github") }}</span
      >
    </a>
    <template v-if="authStore.version">
      <span class="text-muted-color" :class="textSizeClass">•</span>
      <a
        href="https://github.com/Leni-Vienne/urbanist-map/releases"
        target="_blank"
        rel="noopener noreferrer"
        :class="linkClass"
      >
        {{ authStore.version }}
      </a>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/authStore";

const props = defineProps<{
  compact?: boolean;
}>();

const authStore = useAuthStore();
const textSizeClass = props.compact ? "text-[0.65rem]" : "text-xs";
const linkClass = [
  "text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) transition-all duration-150 hover:text-primary-color hover:decoration-primary-color",
  textSizeClass,
];
</script>
