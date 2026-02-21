import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import tailwindcss from "@tailwindcss/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import path from "node:path";
import fs from "fs";
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
              .filter((m) => !m.endsWith(".css"))
              .map((m) => {
                // 1. Force both paths to use forward slashes /
                const cleanRoot = root.replace(/\\/g, "/");
                const cleanModule = m.replace(/\\/g, "/");

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
      filename: "stats.html",
      open: false,
      gzipSize: true,
      template: "treemap", // 'treemap', 'sunburst', 'network', 'list', 'flamegraph', 'raw-data'
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
    license: true,
    cssCodeSplit: true, // AI : Extract CSS per chunk for parallel loading
    rolldownOptions: {
      external: (id) => {
        // AI : Mark CDN URLs as external so they don't get bundled
        return id.includes("unpkg.com/leaflet");
      },
      output: {
        codeSplitting: {
          groups: [
            /*{
              test: (id) => /node_modules\/(primevue|@primevue|@primeuix)/.test(id),
              name: "primevue",
            }*/
            // AI : Split Vue ecosystem for stable long-term caching
            /*{
              test: (id) => /node_modules\/(vue|@vue|pinia|vue-router|vue-i18n)/.test(id),
              name: "vue-core",
            },
            // AI : Split PrimeVue UI library (largest vendor dependency)
            
            // AI : Remaining vendor deps (zod, superjson, uuid, leaflet-distortableimage, etc.)
            {
              test: (id) => id.includes("node_modules"),
              name: "vendor",
            },*/
          ],
        },
      },
    },
  },
  define: {
    //__VUE_OPTIONS_API__: false, -> crashes the app
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_PROD_DEVTOOLS__: false, // doesn't seem to change anything
    // AI : vue-i18n optimizations - tree-shake unused features
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true, // We use globalInjection
    __VUE_I18N_LEGACY_API__: false, // We use composition API (legacy: false)
  },
}));
