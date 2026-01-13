import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import tailwindcss from "@tailwindcss/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { qrcode } from "vite-plugin-qrcode";

// https://vite.dev/config/
export default defineConfig({
  envDir: "../", // Only way that .env can be imported, '../.env' don't work for some reason
  plugins: [
    //fontDisplaySwapPlugin(),
    vue(),
    qrcode(),
    visualizer({
      filename: "stats.html",
      open: false,
      template: "treemap", // 'treemap', 'sunburst', 'network', 'list', 'flamegraph', 'raw-data'
    }),
    tailwindcss(),
    vueDevTools(),
    // eslint-disable-next-line new-cap
    Components({
      resolvers: [
        // eslint-disable-next-line new-cap
        PrimeVueResolver(),
      ],
    }),
  ],
  // AI : Configure aliases and externals for CDN usage
  resolve: {
    alias: {
      // AI : Redirect leaflet imports to our CDN shim
      leaflet: path.resolve(__dirname, "./src/lib/leaflet-umd-shim.ts"),
      // AI : Use vue-i18n runtime-only build (no message compiler, uses JIT compilation)
      "vue-i18n": "vue-i18n/dist/vue-i18n.runtime.esm-bundler.js",
      "@/tables": path.resolve(__dirname, "./back/src/db/schema"),
      "@": "/src",
      "@shared": path.resolve(__dirname, "../shared"),

      // AI : Temporary alias for debugging local library changes
      /*"leaflet-distortableimage": path.resolve(
        __dirname,
        "../../Leaflet.DistortableImage",
      ),*/
    },
  },
  // To prevent annoying automatic reloads in devmode
  optimizeDeps: {
    include: [
      "primevue/autocomplete",
      "primevue/badge",
      "primevue/button",
      "primevue/floatlabel",
      "primevue/datepicker",
      "primevue/textarea",
      "primevue/dialog",
      "primevue/fileupload",
      "primevue/iconfield",
      "primevue/inputicon",
      "primevue/inputtext",
      "primevue/message",
      "primevue/panel",
      "primevue/password",
      "primevue/popover",
      "primevue/checkbox",
      "primevue/progressbar",
      "primevue/radiobutton",
      "primevue/select",
      "primevue/toast",
      //'primevue/virtualscroller',
      "primevue/focustrap",
      "primevue/ripple",
      "primevue/tooltip",
      "primevue/toastservice",
      "primevue/usetoast",
      "primevue/drawer",
      "primevue/accordion",
      "primevue/accordioncontent",
      "primevue/accordionheader",
      "primevue/accordionpanel",
      "primevue/card",
      "primevue/tag",
      "primevue/divider",
    ],
  },
  // AI : External leaflet to prevent bundling
  build: {
    sourcemap: true,
    cssCodeSplit: true, // AI : Extract CSS per chunk for parallel loading
    rollupOptions: {
      external: (id) => {
        // AI : Mark CDN URLs as external so they don't get bundled
        return id.includes("unpkg.com/leaflet");
      },
      output: {
        manualChunks: (id) => {
          // AI : Keep vendor libraries separate for better caching
          if (id.includes("node_modules")) {
            // AI : Order matters - check most specific paths first
            if (
              id.includes("pinia") ||
              id.includes("vue-router") ||
              id.includes("pinia") ||
              id.includes("vue-i18n")
            )
              return "@vue";
            //if (id.includes("@primevue") || id.includes("@primeuix")) return "primevue";
          }

          if (id.includes("locales")) return "locales";
        },
      },
    },
  },
  define: {
    //__VUE_OPTIONS_API__: false, -> crashes the app
    "process.env.NODE_ENV": JSON.stringify("production"),
    // AI : vue-i18n optimizations - tree-shake unused features
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true, // We use globalInjection
    __VUE_I18N_LEGACY_API__: false, // We use composition API (legacy: false)
  },
});
