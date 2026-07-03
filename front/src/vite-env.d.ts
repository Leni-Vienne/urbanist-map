// This file tells TypeScript how to handle files that aren't native TypeScript/JavaScript,
// such as .vue components and other assets, to prevent "Cannot find module" (TS2307) errors.
/// <reference types="vite/client" />

import type Tooltip from "primevue/tooltip";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}

// Volar resolves `v-tooltip` to a `vTooltip` key, while unplugin-vue-components
// generates the auto-registered directive under `Tooltip` in components.d.ts.
declare module "vue" {
  interface GlobalDirectives {
    vTooltip: Tooltip;
  }
}
