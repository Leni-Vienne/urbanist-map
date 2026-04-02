import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import tailwindcss from "@tailwindcss/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
import { qrcode } from "vite-plugin-qrcode";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  envDir: "../", // Only way that .env can be imported, '../.env' don't work for some reason
  plugins: [
    {
      name: "bundle-report-clean",
      apply: "build",
      generateBundle(_, bundle) {
        const report: any = {};
        const root = process.cwd(); // This is your project folder path

        Object.entries(bundle).forEach(([fileName, chunk]) => {
          if (chunk.type === "chunk") {
            // We just "delete" the root path string from every file path
            report[fileName] = Object.keys(chunk.modules)
              //.filter((m) => !m.endsWith(".css"))
              .map((m) => {
                // 1. Force both paths to use forward slashes /
                const cleanRoot = root.replaceAll(/\\/g, "/");
                const cleanModule = m.replaceAll(/\\/g, "/");

                // 2. Now the replace will actually find the match
                return cleanModule.replace(cleanRoot, "");
              });
          }
        });

        fs.mkdirSync("./junk", { recursive: true });
        fs.writeFileSync("./junk/full-bundle-report.json", JSON.stringify(report, null, 2));
        console.log("Done! Check ./junk/full-bundle-report.json");
      },
    },
    //fontDisplaySwapPlugin(),
    vue(),
    qrcode(),
    visualizer({
      filename: "stats.md",
      open: false,
      gzipSize: true,
      // @ts-ignore rollup-plugin-visualiser 7.0 added markdown support but types are not updated yet
      template: "markdown", // 'markdown', 'treemap', 'sunburst', 'network', 'list', 'flamegraph', 'raw-data'
      //exclude: [{ bundle: "**/vendor*" }, { file: "**/node_modules/**" }],
    }),
    tailwindcss(),
    mode === "development" && vueDevTools(),
    // eslint-disable-next-line new-cap
    Components({
      resolvers: [
        // eslint-disable-next-line new-cap
        PrimeVueResolver(),
      ],
    }),
  ],
  // Configure aliases and externals for CDN usage
  resolve: {
    alias: {
      // Redirect leaflet imports to our CDN shim
      leaflet: fileURLToPath(new URL("src/lib/leaflet-umd-shim.ts", import.meta.url)),
      // Use vue-i18n runtime-only build (no message compiler, uses JIT compilation)
      "vue-i18n": "vue-i18n/dist/vue-i18n.runtime.esm-bundler.js",
      "@/tables": fileURLToPath(new URL("../back/src/db/schema", import.meta.url)),
      "@": "/src",
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),

      // Temporary alias for testing local library changes
      //"leaflet-distortableimage": fileURLToPath(new URL("../../Leaflet.DistortableImage", import.meta.url)),
      //"leaflet-toolbar": fileURLToPath(new URL("../../Leaflet.toolbar", import.meta.url)),
    },
  },
  // To prevent annoying automatic reloads in devmode
  optimizeDeps: {
    include: [
      "@geoman-io/leaflet-geoman-free",
      "primevue/selectbutton",
      "primevue/autocomplete",
      "primevue/badge",
      "primevue/button",
      "primevue/togglebutton",
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
      "primevue/datatable",
      "primevue/column",
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
  // External leaflet to prevent bundling
  build: {
    sourcemap: false,
    license: true,
    cssCodeSplit: true, // Extract CSS per chunk for parallel loading
    rolldownOptions: {
      external: (id) => {
        // Mark CDN URLs as external so they don't get bundled
        return id.includes("unpkg.com/leaflet");
      },
      output: {
        codeSplitting: {
          groups: [
            // Keep maplibre-gl in a single chunk — splitting it causes minified
            // symbol errors (e.g. "Gi is not defined") in the Web Worker callback.
            {
              name: "maplibre",
              test: (id: string) => id.includes("node_modules/maplibre-gl/"),
            },
            // Consolidate the ~14 tiny PrimeVue micro-chunks that Rolldown extracts as
            // shared deps of async components. All of these are already page-loaded, so merging
            // reduces HTTP requests without changing load timing or pulling in lazy-only code.
            // Deliberately excludes form-only components (radiobutton, textarea, floatlabel,
            // password) which are lazy-only and should stay that way.
            {
              name: "primevue-extras",
              test: (id: string) =>
                /node_modules\/primevue\/(virtualscroller|tooltip|button|checkbox|focustrap|inputtext|tag|progressspinner|overlayeventbus|utils|toasteventbus)\//.test(
                  id,
                ) ||
                /node_modules\/@primeuix\/styles\/dist\/(virtualscroller|tooltip|button|checkbox|inputtext|tag|progressspinner|popover)\//.test(
                  id,
                ) ||
                id.includes("node_modules/primevue/popover/") ||
                /node_modules\/@primevue\/icons\/(chevrondown|times|chevronleft|chevronright|chevronup|minus|windowmaximize|windowminimize)\//.test(
                  id,
                ) ||
                /node_modules\/@primevue\/core\/(utils|baseinput|baseeditableholder)\//.test(id) ||
                id.includes("node_modules/@primeuix/utils/dist/eventbus"),
            },
            // Consolidate the ~12 tiny own-code chunks that Rolldown extracts because
            // they are shared between multiple lazy-loaded components. All confirmed page-loaded.
            // Grouping them into one chunk cuts ~12 HTTP requests from the initial load.
            {
              name: "app-utils",
              test: (id: string) =>
                /\/front\/src\/stores\/(authStore|uiStore|pinia\/pendingModificationsStore)/.test(
                  id,
                ) ||
                /\/front\/src\/utils\/(imageUrl|imageErrorHandler)/.test(id) ||
                id.includes("/front/src/constants/mapConstants") ||
                /\/front\/src\/composables\/(ui\/useToast)/.test(id) ||
                /\/front\/src\/services\/(core\/errorHandling|overlay\/(overlayLifecycle|completionFilters|modeSwitching)|navigation\/locationNavigation)/.test(
                  id,
                ),
            },
            // Consolidate overlay service modules that are only loaded via panel clicks
            // (useOverlayClickHandler, overlayNavigation, etc.) into a single lazy chunk.
            // overlayMarkers/overlayHistory/entityRemoval are excluded because they load
            // during the zoom-into-city flow and must remain independently loadable.
            {
              name: "overlay-services",
              test: (id: string) =>
                // Do NOT include dynamic import() entry points here (overlayEditing,
                // overlayNavigation, useOverlayClickHandler) - they create stub+real code
                // duplication. Their deps (overlay.ts, overlayCityCache, etc.) are included
                // and those get pulled into overlay-services via static import chains.
                // The async entry files load overlay-services as a dep chunk automatically.
                /\/front\/src\/services\/overlay\/(overlay|overlayCityCache|overlayPositionResolver)\.ts/.test(
                  id,
                ) || id.includes("/front/src/services/project/projects.ts"),
            },
            // Consolidate the 9-chunk cascade triggered when CurrentLocationPanel first mounts
            // (applies to both zoom→click-on-overlay and LatestContributionsPanel click flows).
            // Only TS utility files here — NOT Vue component files. Adding .vue async entries
            // to the group drags their transitive deps (vue-i18n) out of the initial bundle
            // into this lazy chunk → Rolldown preloads it at startup again to satisfy the
            // conflict, defeating the purpose. Async components (CurrentLocationPanel,
            // ProjectAccordionPanel) load location-panel automatically as a dep chunk.
            {
              name: "location-panel",
              test: (id: string) =>
                /\/front\/src\/utils\/(projectDateFormat|urlFormat|flexibleDateHelpers|projectFactories)\.ts/.test(
                  id,
                ) ||
                /\/front\/src\/composables\/overlay\/(useNewProject|useChangeRequestPreview)\.ts/.test(
                  id,
                ) ||
                id.includes("/front/src/utils/statusHelpers.ts") ||
                /node_modules\/primevue\/(accordion|accordioncontent|accordionheader|accordionpanel|card)\//.test(
                  id,
                ) ||
                /node_modules\/@primeuix\/styles\/dist\/(accordion|card)\//.test(id),
            },
          ],
        },
      },
    },
  },
  define: {
    //__VUE_OPTIONS_API__: false, -> crashes the app
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_PROD_DEVTOOLS__: false, // doesn't seem to change anything
    // vue-i18n optimizations - tree-shake unused features
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true, // We use globalInjection
    __VUE_I18N_LEGACY_API__: false, // We use composition API (legacy: false)
  },
}));
