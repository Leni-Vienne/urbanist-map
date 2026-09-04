import { defineConfig, isCSSRequest, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import tailwindcss from "@tailwindcss/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
import { qrcode } from "vite-plugin-qrcode";
import { stringify } from "yaml";

interface BundleReportEntry {
  javascriptModules: string[];
  cssModules?: string[];
  emittedCss?: string[];
}

function createBundleReportEntry(
  modules: string[],
  emittedCss: Iterable<string>,
): BundleReportEntry {
  const javascriptModules = modules.filter((module) => !isCSSRequest(module));
  const cssModules = modules.filter(isCSSRequest);
  const cssAssets = [...emittedCss];

  return {
    javascriptModules,
    ...(cssModules.length > 0 && { cssModules }),
    ...(cssAssets.length > 0 && { emittedCss: cssAssets }),
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // PORT lives in the root .env (one level up from this config), so load it here to point
  // the proxy at the backend. Empty prefix loads non-VITE vars too (PORT is not VITE-prefixed).
  const rootDir = fileURLToPath(new URL("..", import.meta.url));
  const rootEnv = loadEnv(mode, rootDir, "");
  const backendTarget = `http://localhost:${rootEnv.PORT || 3000}`;

  return {
    /*experimental: {
      bundledDev: true,
    },*/
    envDir: "../",
    server: {
      host: true,
      proxy: {
        "/trpc": backendTarget,
        "/api": backendTarget,
        "/uploads": backendTarget,
      },
    },
    // `vite preview` ignores server.* and binds to localhost by default, so a phone
    // times out trying to reach it. Bind to the LAN here too. Note: preview serves the
    // production bundle (import.meta.env.DEV === false), so it talks to the backend at
    // build-time VITE_API_BASE_URL, not through this proxy.
    preview: {
      host: true,
    },
    plugins: [
      {
        name: "bundle-report-clean",
        apply: "build",
        generateBundle(_, bundle) {
          const fullReport: Record<string, BundleReportEntry> = {};
          const lightReport: Record<string, BundleReportEntry> = {};
          const root = process.cwd();

          Object.entries(bundle).forEach(([fileName, chunk]) => {
            if (chunk.type === "chunk") {
              const cleanRoot = root.replaceAll(/\\/g, "/");
              const modules = Object.keys(chunk.modules).map((m) => {
                const cleanModule = m.replaceAll(/\\/g, "/");
                return cleanModule.replace(cleanRoot, "");
              });

              fullReport[fileName] = createBundleReportEntry(
                modules,
                chunk.viteMetadata?.importedCss ?? [],
              );

              const lightModules = modules.filter(
                (m) =>
                  !m.includes("node_modules") && !m.startsWith("\0") && !m.startsWith("virtual:"),
              );
              if (lightModules.length > 0) {
                lightReport[fileName] = createBundleReportEntry(
                  lightModules,
                  chunk.viteMetadata?.importedCss ?? [],
                );
              }
            }
          });

          fs.mkdirSync("./.bundle-report", { recursive: true });
          fs.writeFileSync("./.bundle-report/full-bundle-report.yml", stringify(fullReport));
          fs.writeFileSync("./.bundle-report/light-bundle-report.yml", stringify(lightReport));
        },
      },
      vue(),
      qrcode(),
      visualizer({
        filename: ".bundle-report/stats.md",
        open: false,
        gzipSize: true,
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
        // Use vue-i18n runtime-only build (no message compiler, uses JIT compilation)
        "vue-i18n": "vue-i18n/dist/vue-i18n.runtime.esm-bundler.js",
        "@": "/src",
        "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      },
    },
    // To prevent annoying automatic reloads in devmode
    optimizeDeps: {
      include: [
        "@lucide/vue",
        "primevue/accordion",
        "primevue/accordioncontent",
        "primevue/accordionheader",
        "primevue/accordionpanel",
        "primevue/autocomplete",
        "primevue/badge",
        "primevue/button",
        "primevue/checkbox",
        "primevue/column",
        "primevue/datatable",
        "primevue/datepicker",
        "primevue/dialog",
        "primevue/divider",
        "primevue/floatlabel",
        "primevue/focustrap",
        "primevue/inputtext",
        "primevue/message",
        "primevue/panel",
        "primevue/password",
        "primevue/popover",
        "primevue/progressspinner",
        "primevue/ripple",
        "primevue/select",
        "primevue/selectbutton",
        "primevue/slider",
        "primevue/tag",
        "primevue/textarea",
        "primevue/toast",
        "primevue/toastservice",
        "primevue/toggleswitch",
        "primevue/tooltip",
        "primevue/usetoast",
        "terra-draw-maplibre-gl-adapter",
        "terra-draw",
      ],
    },
    build: {
      license: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Keep maplibre-gl in a single chunk, splitting it causes minified
              // symbol errors (e.g. "Gi is not defined") in the Web Worker callback.
              {
                name: "maplibre",
                test: (id: string) => id.includes("node_modules/maplibre-gl/"),
              },
              // Consolidate the page-loaded vendor micro-chunks (PrimeVue shared deps of async
              // components, plus pinia and the tRPC client stack) into one chunk. All of these
              // are already page-loaded, so merging reduces HTTP requests without changing load
              // timing or pulling in lazy-only code. Deliberately excludes form-only PrimeVue
              // components (radiobutton, textarea, floatlabel, password) which are lazy-only
              // and should stay that way.
              {
                name: "primevue-extras",
                test: (id: string) =>
                  /node_modules\/primevue\/(?:virtualscroller|tooltip|button|checkbox|focustrap|inputtext|tag|progressspinner|slider|overlayeventbus|utils|toasteventbus)\//.test(
                    id,
                  ) ||
                  /node_modules\/@primeuix\/styles\/dist\/(?:virtualscroller|tooltip|button|checkbox|inputtext|tag|progressspinner|slider|popover)\//.test(
                    id,
                  ) ||
                  id.includes("node_modules/primevue/popover/") ||
                  /node_modules\/@primevue\/icons\/(?:chevrondown|times|chevronleft|chevronright|chevronup|minus|windowmaximize|windowminimize)\//.test(
                    id,
                  ) ||
                  /node_modules\/@primevue\/core\/(?:utils|baseinput|baseeditableholder)\//.test(
                    id,
                  ) ||
                  id.includes("node_modules/@primeuix/utils/dist/eventbus") ||
                  /node_modules\/(?:pinia|@trpc|superjson|is-what|copy-anything|uuid)\//.test(id),
              },
              // Consolidate the tiny own-code chunks that Rolldown extracts because they
              // are shared between the entry and lazy-loaded components. All confirmed loaded
              // on initial page view (zoomed out, logged out), so merging them cuts HTTP
              // requests without pulling anything new into the initial load.
              {
                name: "app-core",
                test: (id: string) =>
                  /\/front\/src\/stores\/(?:authStore|uiStore|projectStore|overlayStore|focusStore|moderationStore|changeRequestStore)\.ts/.test(
                    id,
                  ) ||
                  /\/front\/src\/services\/core\/(?:toast|errorHandling|map|viewport|filters|settings|mapNavigation|projectSelection|markersSvg)\.ts/.test(
                    id,
                  ) ||
                  /\/front\/src\/services\/overlay\/(?:markers|visibility|data|selection|mapLayers|transform|history|editing|unsavedState)\.ts/.test(
                    id,
                  ) ||
                  /\/front\/src\/services\/(?:moderation\/moderationCountrySync|submission\/stagedRenderState|project\/projectMutations)\.ts/.test(
                    id,
                  ) ||
                  /\/front\/src\/utils\/(?:typeFactories|geojson|imageUrl|cornersBounds)\.ts/.test(
                    id,
                  ) ||
                  id.includes("/front/src/constants/mapConstants.ts") ||
                  id.includes("/shared/overlayValidation.ts") ||
                  id.includes("/front/src/locales/index.ts") ||
                  id.includes("/front/src/client.ts") ||
                  id.includes("/front/src/components/map/FilterPanelContent.vue"),
              },
            ],
          },
        },
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      __VUE_PROD_DEVTOOLS__: false,
      // vue-i18n optimizations - tree-shake unused features
      __INTLIFY_PROD_DEVTOOLS__: false,
      __VUE_I18N_FULL_INSTALL__: true, // We use globalInjection
      __VUE_I18N_LEGACY_API__: false, // We use composition API (legacy: false)
    },
  };
});
