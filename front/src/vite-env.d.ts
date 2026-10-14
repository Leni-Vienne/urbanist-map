// Vite's client types declare asset imports and import.meta.env.
/// <reference types="vite/client" />

import type Tooltip from "primevue/tooltip";

// Volar resolves `v-tooltip` to a `vTooltip` key, while unplugin-vue-components
// generates the auto-registered directive under `Tooltip` in components.d.ts.
declare module "vue" {
  interface GlobalDirectives {
    vTooltip: Tooltip;
  }
}
