<template>
  <div
    class="shrink-0 bg-content-background border-t border-surface flex justify-center items-center gap-2 text-xs text-muted-color"
    :class="
      compact ? 'py-[0.2rem] px-4' : 'pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] px-2'
    "
  >
    <a href="/legal" :class="linkClass">{{ $t("footer.legal") }}</a>
    <span>•</span>
    <a href="/contact" :class="linkClass">{{ $t("common.contact") }}</a>
    <span>•</span>
    <a
      href="https://github.com/Leni-Vienne/urbanist-map"
      target="_blank"
      rel="noopener noreferrer"
      class="group inline-flex items-center gap-1 transition-colors duration-150 hover:text-primary-color"
    >
      <i class="pi pi-github"></i>
      <span
        class="underline underline-offset-2 decoration-(--p-text-muted-color) group-hover:decoration-primary-color"
        >{{ $t("footer.github") }}</span
      >
    </a>
    <template v-if="authStore.version">
      <span>•</span>
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

defineProps<{
  compact?: boolean;
}>();

const authStore = useAuthStore();
const linkClass =
  "underline underline-offset-2 decoration-(--p-text-muted-color) transition-colors duration-150 hover:text-primary-color hover:decoration-primary-color";
</script>
