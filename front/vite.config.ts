import { defineConfig } from "vite";
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'path'
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  envDir: '../', // only way that .env can be imported, '../.env' don't work for some reason
  plugins: [
    vue(),
    visualizer({
      filename: 'stats.html',
      open: false,
      template: 'treemap', // 'treemap', 'sunburst', 'network'
    }),
    tailwindcss(),
    vueDevTools(),
    Components({
      resolvers: [
        PrimeVueResolver()
      ]
    })
  ],
  // AI : Configure aliases and externals for CDN usage
  resolve: {
    alias: {
      // AI : Redirect leaflet imports to our CDN shim
      'leaflet': path.resolve(__dirname, './src/lib/leaflet-umd-shim.ts'),
      // AI : Redirect supabase imports to our CDN shim
      '@supabase/supabase-js': path.resolve(__dirname, './src/lib/supabase-umd-shim.ts'),
      '@tables': path.resolve(__dirname, './back/src/db/schema'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@composables': path.resolve(__dirname, './src/composables'),
      '@components': path.resolve(__dirname, './src/components'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@client': path.resolve(__dirname, './src/client'),
    }
  },
  // AI : External leaflet and supabase to prevent bundling 
  build: {
    rollupOptions: {
      external: (id) => {
        // AI : Mark CDN URLs as external so they don't get bundled
        return id.includes('unpkg.com/leaflet') || id.includes('jsdelivr.net/npm/@supabase/supabase-js')
      }
    }
  }
})
