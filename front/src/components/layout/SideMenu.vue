<template>
  <div
    class="relative z-10 shrink-0 w-95 bg-content-hover-background shadow-[2px_0_8px_rgba(0,0,0,0.1),6px_0_24px_-6px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden h-screen max-h-screen"
    style="
      --p-accordion-header-hover-background: var(--p-content-hover-background);
      --p-accordion-header-active-hover-background: var(--p-content-hover-background);
    "
  >
    <!-- Fixed header containing title and navigation tabs -->
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

    <!-- Selected project/overlay detail, docked above the tab content so the list it was picked from
         stays visible and browsable. Sized by its content up to a cap, past which the panel's own
         fields area scrolls. -->
    <Transition name="detail-dock">
      <div v-if="detailVisible" class="detail-dock shrink-0 border-b border-surface">
        <ProjectDetailPanel />
      </div>
    </Transition>

    <!-- Scrollable content area -->
    <PanelContent content-container-class="flex-1 overflow-y-auto flex flex-col min-h-0" />

    <!-- Footer with legal links. pb adds env(safe-area-inset-bottom) so the OS-reserved
         area (gesture pill, classic nav bar, home indicator) doesn't overlap the links. -->
    <div
      class="shrink-0 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] px-2 bg-content-hover-background border-t border-surface flex justify-center items-center gap-2"
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
      <template v-if="authStore.version">
        <span class="text-muted-color text-xs">•</span>
        <a
          href="https://github.com/Leni-Vienne/urbanist-map/releases"
          target="_blank"
          rel="noopener noreferrer"
          class="text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) text-xs transition-all duration-150 hover:text-primary-color hover:decoration-primary-color"
        >
          {{ authStore.version }}
        </a>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import PanelContent from "./PanelContent.vue";
import PanelTabs from "./PanelTabs.vue";
import { useAuthStore } from "@/stores/authStore";
import { useDetailPanel } from "@/composables/layout/useDetailPanel";

// Lazy loaded so the detail panel shares the same async chunk scope as PanelContent's copy.
const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const authStore = useAuthStore();

const { detailVisible, activeTab } = useDetailPanel();
</script>

<style scoped>
/* Sized by its content so a sparse detail costs the list nothing, capped so a rich one can't crowd
   it out. The flex column is what makes the cap bite: the panel shrinks into it and thereby gains
   the definite height its fields area needs in order to scroll. */
.detail-dock {
  display: flex;
  flex-direction: column;
  max-height: min(45%, 26rem);
}

/* The dock grows and shrinks in place, pushing the list down rather than covering it. */
.detail-dock-enter-active,
.detail-dock-leave-active {
  overflow: hidden;
  transition:
    max-height 0.25s ease-out,
    opacity 0.25s ease-out;
}

.detail-dock-enter-from,
.detail-dock-leave-to {
  max-height: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .detail-dock-enter-active,
  .detail-dock-leave-active {
    transition: opacity 0.25s ease-out;
  }
}
</style>
