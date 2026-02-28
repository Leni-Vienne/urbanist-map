<template>
  <div class="app-container">
    <MapSvgDefs />
    <Toast />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import "leaflet-distortableimage/dist/leaflet.distortableimage.css";
import "./assets/style.css"; // Must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import "primeicons/primeicons.css";
import MapSvgDefs from "@/components/map/MapSvgDefs.vue";

if (import.meta.env.VITE_DEBUG) {
  // AI : Log all JS chunks downloaded during the initial page load
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
      console.log(`Initial JS Chunks Loaded:\n\n${cleanList}\n\nTotal Transfer: ${totalKB} kB`);
    }, 1000);
  });

  // AI : Describe the nearest meaningful DOM ancestor of a click target for logging
  function describeClickTarget(target: EventTarget | null): string {
    if (!(target instanceof Element)) return "unknown";
    const el = target.closest("button, a, [role=button], [role=menuitem], li") ?? target;
    const text = el.textContent?.trim().slice(0, 50);
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls =
      el.className && typeof el.className === "string"
        ? `.${el.className.trim().split(/\s+/)[0]}`
        : "";
    return `<${tag}${id}${cls}>${text ? ` "${text}"` : ""}`;
  }

  // AI : Batch lazy chunks that arrive close together and print them grouped by trigger
  const pageLoadCutoff = performance.now() + 1500;
  let batchTrigger = "spontaneously loaded";
  let batchLines: string[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  function flushBatch() {
    if (batchLines.length === 0) return;
    console.log(`${batchTrigger}\n${batchLines.join("\n")}`);
    batchLines = [];
    batchTimer = null;
  }

  globalThis.addEventListener(
    "click",
    (e) => {
      batchTrigger = `After click on ${describeClickTarget(e.target)}`;
    },
    true,
  );

  // AI : Observe new resource entries in real-time and group lazy chunks under their trigger
  const lazyObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.name.endsWith(".js")) continue;
      if (entry.startTime < pageLoadCutoff) continue; // AI : skip initial load window

      const name = entry.name.split("/").pop();
      const size = ((entry as PerformanceResourceTiming).transferSize / 1024).toFixed(2);
      batchLines.push(`${name} | ${size} kB`);

      if (batchTimer !== null) clearTimeout(batchTimer);
      batchTimer = setTimeout(flushBatch, 150);
    }
  });

  lazyObserver.observe({ type: "resource", buffered: false });
}
</script>
