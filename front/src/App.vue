<template>
  <div class="app-container">
    <MapSvgDefs />
    <Toast />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import "leaflet-toolbar/dist/leaflet.toolbar.css";
import "leaflet-distortableimage/dist/leaflet.distortableimage.css";
import "./assets/style.css"; // Must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import "primeicons/primeicons.css";
import MapSvgDefs from "@/components/map/MapSvgDefs.vue";

if (import.meta.env.VITE_DEBUG) {
  // code tohave easy access to what's loaded on initial page load
  window.addEventListener("load", () => {
    setTimeout(() => {
      const scripts = performance
        .getEntriesByType("resource")
        .filter((res) => res.initiatorType === "script" || res.name.endsWith(".js"));

      const cleanList = scripts
        .map((res) => ({
          name: res.name.split("/").pop(),
          size: res.transferSize,
        }))
        .sort((a, b) => b.size - a.size)
        .map(({ name, size }) => `${name} | ${(size / 1024).toFixed(2)} kB`)
        .join("\n");

      const totalKB = (scripts.reduce((sum, res) => sum + res.transferSize, 0) / 1024).toFixed(2);
      const finalReport = `${cleanList}\n\nTotal Transfer: ${totalKB} kB`;

      console.log(finalReport);
    }, 1000);
  });
}
</script>
