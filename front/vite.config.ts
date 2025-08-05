import { defineConfig, type PluginOption } from "vite";
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'path'
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  envDir: '../.env',
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
  // AI : Add resolver to use the Vue version with runtime compiler
  resolve: {
    alias: {
      'vue': 'vue/dist/vue.esm-bundler.js', //  otherwise vite is not happy when building
      '@tables': path.resolve(__dirname, './back/src/db/schema'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@composables': path.resolve(__dirname, './src/composables'),
      '@components': path.resolve(__dirname, './src/components'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@client': path.resolve(__dirname, './src/client'),
    }
  }
})
