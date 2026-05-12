<template>
  <div
    :class="[
      'relative shrink-0 bg-content-hover-background border-r border-surface shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden transition-all duration-300 ease-in-out h-screen max-h-screen',
      isOpen ? 'w-95' : 'w-0 border-r-0',
      'max-md:fixed max-md:top-0 max-md:left-0 max-md:w-[85%] max-md:max-w-95 max-md:h-screen max-md:border-r-0 max-md:shadow-[2px_0_8px_rgba(0,0,0,0.15)] max-md:duration-300 max-md:ease-in-out',
      isOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
    ]"
    style="
      --p-accordion-header-hover-background: var(--p-content-hover-background);
      --p-accordion-header-active-hover-background: var(--p-content-hover-background);
    "
  >
    <!-- Fixed header containing title, close button, and navigation tabs -->
    <div class="sticky top-0 z-10 shrink-0 bg-content-hover-background border-b border-surface">
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

    <!-- Scrollable content area -->
    <PanelContent
      :active-tab="activeTab"
      content-container-class="flex-1 overflow-y-auto flex flex-col min-h-0"
    />

    <!-- Footer with legal links -->
    <div
      class="shrink-0 py-2 px-2 bg-content-hover-background border-t border-surface flex justify-center items-center gap-2"
    >
      <a
        href="/legal"
        class="text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) text-xs transition-all duration-150 hover:text-primary-color hover:decoration-primary-color"
        >{{ $t("footer.legal") }}</a
      >
      <span class="text-muted-color text-xs">•</span>
      <a
        href="/contact"
        class="text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) text-xs transition-all duration-150 hover:text-primary-color hover:decoration-primary-color"
        >{{ $t("common.contact") }}</a
      >
      <span class="text-muted-color text-xs">•</span>
      <a
        href="https://github.com/Leni-Vienne/urbanist-map"
        target="_blank"
        rel="noopener noreferrer"
        class="group inline-flex items-center gap-1 text-(--p-text-color-secondary) text-xs transition-all duration-150 hover:text-primary-color"
      >
        <i class="pi pi-github text-xs"></i>
        <span
          class="underline underline-offset-2 decoration-(--p-text-muted-color) group-hover:decoration-primary-color"
          >{{ $t("footer.github") }}</span
        >
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, computed } from "vue";
import PanelContent from "./PanelContent.vue";
import PanelTabs from "./PanelTabs.vue";
import { usePanelTabs } from "@/composables/layout/usePanelTabs";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import type { PanelTab } from "@/types";

defineProps<{
  isOpen: boolean;
  isModerator?: boolean;
}>();

defineEmits<{
  close: [];
}>();

const uiStore = useUiStore();
const authStore = useAuthStore();

const { setActiveTab } = usePanelTabs();

const activeTab = computed<PanelTab>({
  get: () => uiStore.activeTab,
  set: (value) => setActiveTab(value),
});

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    if (isAuthenticated && uiStore.postLoginCallback) {
      uiStore.executePostLoginCallback();
    }
  },
);

usePanelTabs();
</script>
