<template>
  <div
    class="relative z-10 shrink-0 w-95 bg-content-background shadow-[2px_0_8px_rgba(0,0,0,0.1),6px_0_24px_-6px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden h-screen max-h-screen"
    style="
      --p-accordion-header-hover-background: var(--p-content-hover-background);
      --p-accordion-header-active-hover-background: var(--p-content-hover-background);
    "
  >
    <!-- Fixed header containing title and navigation tabs -->
    <div class="sticky top-0 z-10 shrink-0 bg-content-background border-b border-surface">
      <div class="py-2 px-4 flex items-center justify-between">
        <div>
          <h2
            class="m-0 text-[1.75rem] font-semibold leading-tight text-color max-md:text-[1.375rem]"
          >
            {{ $t("app.title") }}
          </h2>
          <p class="mt-1 text-sm text-muted-color leading-snug">
            {{ $t("app.subtitle") }}
          </p>
        </div>
      </div>

      <!-- Tab navigation inside fixed header -->
      <PanelTabs v-model:active-tab="activeTab" variant="desktop" />
    </div>

    <PanelContent content-container-class="flex-1 flex flex-col min-h-0 overflow-hidden" />

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
