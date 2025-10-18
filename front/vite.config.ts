import { defineConfig } from "vite";
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'path'
import { visualizer } from "rollup-plugin-visualizer";
import istanbul from 'vite-plugin-istanbul';
/*import type { Plugin } from 'vite';

// AI : Vite plugin to replace font-display: block with font-display: swap for better performance
function fontDisplaySwapPlugin(): Plugin {
  return {
    name: 'font-display-swap',
    enforce: 'post',
    generateBundle(_options, bundle) {
      // AI : Process all CSS assets in the bundle
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && asset.type === 'asset' && typeof asset.source === 'string') {
          // AI : Replace font-display: block with font-display: swap
          asset.source = asset.source.replace(
            /font-display:\s*block/g,
            'font-display: swap'
          );

          // AI : Add font-display: swap if missing from @font-face
          asset.source = asset.source.replace(
            /@font-face\s*\{([^}]*)\}/g,
            (match, content) => {
              if (!content.includes('font-display')) {
                return `@font-face {${content}font-display: swap;}`;
              }
              return match;
            }
          );
        }
      }
    }
  };
}*/

// https://vite.dev/config/
export default defineConfig({
  envDir: '../', // only way that .env can be imported, '../.env' don't work for some reason
  plugins: [
    //fontDisplaySwapPlugin(),
    vue(),
    visualizer({
      filename: 'stats.html',
      open: false,
      template: 'treemap', // 'treemap', 'sunburst', 'network', 'list', 'flamegraph', 'raw-data'
    }),
    tailwindcss(),
    vueDevTools(),
    Components({
      resolvers: [
        PrimeVueResolver()
      ]
    }),
    istanbul({
      include: 'front/src/*',
      exclude: ['node_modules', 'test/'],
      extension: ['.js', '.ts', '.vue'],
      requireEnv: false,
    }),
  ],
  // AI : Configure aliases and externals for CDN usage
  resolve: {
    alias: {
      // AI : Redirect leaflet imports to our CDN shim
      'leaflet': path.resolve(__dirname, './src/lib/leaflet-umd-shim.ts'),
      // AI : Use vue-i18n runtime-only build (no message compiler, uses JIT compilation)
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js',
      '@tables': path.resolve(__dirname, './back/src/db/schema'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@composables': path.resolve(__dirname, './src/composables'),
      '@components': path.resolve(__dirname, './src/components'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@client': path.resolve(__dirname, './src/client'),
    }
  },
  // to prevent annoying automatic reloads in devmode 
  optimizeDeps: {
    include: [
      'primevue/badge',
      'primevue/button',
      'primevue/floatlabel',
      'primevue/datepicker',
      'primevue/textarea',
      'primevue/dialog',
      'primevue/fileupload',
      'primevue/iconfield',
      'primevue/inputicon',
      'primevue/inputtext',
      'primevue/message',
      'primevue/panel',
      'primevue/password',
      'primevue/popover',
      'primevue/progressbar',
      'primevue/radiobutton',
      'primevue/select',
      'primevue/toast',
      //'primevue/virtualscroller',
      'primevue/focustrap',
      'primevue/ripple',
      'primevue/tooltip',
      'primevue/toastservice',
      'primevue/usetoast',
      'primevue/drawer'
    ]
  },
  // AI : External leaflet to prevent bundling 
  build: {
    sourcemap: 'hidden', // AI : Hide sourcemaps to silence istanbul warning
    rollupOptions: {
      external: (id) => {
        // AI : Mark CDN URLs as external so they don't get bundled
        return id.includes('unpkg.com/leaflet')
      }
    }
  },
  define: {
    //__VUE_OPTIONS_API__: false, -> crashes the app
    'process.env.NODE_ENV': JSON.stringify('production'),
    // AI : vue-i18n optimizations - tree-shake unused features
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true, // we use globalInjection
    __VUE_I18N_LEGACY_API__: false   // we use composition API (legacy: false)
  },
})
