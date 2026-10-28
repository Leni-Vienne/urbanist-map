<template>
  <div
    class="z-10 shrink-0 w-95 bg-content-background shadow-[2px_0_8px_rgba(0,0,0,0.1),6px_0_24px_-6px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden"
    style="
      --p-accordion-header-hover-background: var(--p-content-hover-background);
      --p-accordion-header-active-hover-background: var(--p-content-hover-background);
    "
  >
    <div class="shrink-0 py-2 px-4">
      <h2 class="text-[1.75rem] font-semibold leading-tight text-color">
        {{ $t("app.title") }}
      </h2>
      <p class="mt-1 text-sm text-muted-color leading-snug">
        {{ $t("app.subtitle") }}
      </p>
    </div>

    <PanelTabs v-model:active-tab="activeTab" variant="desktop" />

    <PanelContent class="overflow-hidden" />

    <PanelFooter />
  </div>
</template>

<script setup lang="ts">
import PanelContent from "./PanelContent.vue";
import PanelFooter from "./PanelFooter.vue";
import PanelTabs from "./PanelTabs.vue";
import { useDetailPanel } from "@/composables/layout/useDetailPanel";

const { activeTab } = useDetailPanel();
</script>
