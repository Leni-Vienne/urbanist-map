// These unit tests supply only the MapLibre methods each protocol uses; no GL map is constructed.
// oxlint-disable anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion
import { expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import type { Map as MaplibreMap } from "maplibre-gl";

const originalMatchMedia = globalThis.matchMedia;
globalThis.matchMedia = (media) =>
  Object.assign(new EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
  });
const registry = await import("./mapLayers");
const map = await import("@/services/core/map");
globalThis.matchMedia = originalMatchMedia;

test.each(["cancel", "teardown"])(
  "%s suppresses image-ready delivery already queued as a microtask",
  async (action) => {
    setActivePinia(createPinia());
    // Exercise registry notification timing, not image downloading or GL rendering.
    const target = {
      getSource: (): object | undefined => undefined,
      getLayer: (): object | undefined => undefined,
      getStyle: () => ({ layers: [] }),
      addSource: () => {},
      addLayer: () => {},
    } as unknown as MaplibreMap;
    const getMap = spyOn(map, "getMap").mockReturnValue(target);
    const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(target);
    try {
      const ready = mock(() => {});
      const cancel = registry.whenImageReady("image", ready);
      registry.createOverlayImage("image", "image.webp", [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 1 },
        { lat: 1, lng: 0 },
      ]);
      if (action === "cancel") cancel();
      else registry.clearMapObjectRegistry();
      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();
    } finally {
      registry.clearMapObjectRegistry();
      getMap.mockRestore();
      currentMap.mockRestore();
    }
  },
);
