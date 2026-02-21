<template>
  <div class="app-container">
    <MapSvgDefs />
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
        .map((res) => {
          const name = res.name.split("/").pop();
          const size = (res.transferSize / 1024).toFixed(2);
          return `${name} | ${size} kB`;
        })
        .join("\n");

      const totalKB = (scripts.reduce((sum, res) => sum + res.transferSize, 0) / 1024).toFixed(2);
      const finalReport = `${cleanList}\n\nTotal Transfer: ${totalKB} kB`;

      if (typeof copy === "function") {
        copy(finalReport);
        console.log(
          "%c✅ Report copied to clipboard! Paste it into ./junk/pageLoad.txt",
          "color: #4CAF50; font-weight: bold;",
        );
      } else {
        console.log(finalReport);
      }
    }, 1000);
  });
}
</script>
