import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue() as any],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test-setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/back/**", // AI : Exclude backend tests - they use Bun test runner
      "**/*.disabled.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./front/src"),
      "@composables": path.resolve(__dirname, "./front/src/composables"),
      "@components": path.resolve(__dirname, "./front/src/components"),
      "@types": path.resolve(__dirname, "./front/src/types.ts"),
      "@client": path.resolve(__dirname, "./front/src/client.ts"),
    },
  },
  define: {
    // AI : Define environment variables for tests
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:3000"),
  },
});
