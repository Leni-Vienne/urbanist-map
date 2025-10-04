import { defineConfig } from "vite";
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'path'
import { visualizer } from "rollup-plugin-visualizer";
import istanbul from 'vite-plugin-istanbul';

// https://vite.dev/config/
export default defineConfig({
  envDir: '../', // only way that .env can be imported, '../.env' don't work for some reason
  plugins: [
    vue(),
    visualizer({
      filename: 'stats.html',
      open: false,
      template: 'raw-data', // 'treemap', 'sunburst', 'network', 'list', 'flamegraph', 'raw-data'
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
  // removes vue devtools in production (and more, from 809Kb to 691Kb)
  define: {
    __VUE_PROD_DEVTOOLS__: false,
    'process.env.NODE_ENV': JSON.stringify('production')
  }
})
