// These unit tests supply only the MapLibre methods each protocol uses; no GL map is constructed.
// oxlint-disable anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion
import { expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import type { Map as MaplibreMap } from "maplibre-gl";

const originalStorage = globalThis.localStorage;
const storage: Pick<Storage, "getItem"> = { getItem: () => null };
globalThis.localStorage = storage as Storage;
const originalMatchMedia = globalThis.matchMedia;
globalThis.matchMedia = (media) =>
  Object.assign(new EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
  });
const { addTileLayer, switchTileLayer } = await import("./basemap");
const map = await import("@/services/core/map");
globalThis.matchMedia = originalMatchMedia;
globalThis.localStorage = originalStorage;

// Only events and style requests are simulated; these tests do not render MapLibre layers.
function pendingMap() {
  const listeners = new Map<string, Set<() => void>>();
  const setStyle = mock(() => {});
  const target = {
    isStyleLoaded: (): boolean | void => false,
    getZoom: () => 18,
    getCenter: () => ({ lat: 0, lng: 0 }),
    setMissingStyleImageResolver: () => {},
    setStyle,
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as MaplibreMap;
  function listenerCount(): number {
    return [...listeners.values()].reduce((count, set) => count + set.size, 0);
  }
  return { target, setStyle, listenerCount };
}

test("satellite resolution started by a retired map cannot switch a replacement map", async () => {
  setActivePinia(createPinia());
  const old = pendingMap();
  const next = pendingMap();
  const getMap = spyOn(map, "getMap").mockReturnValue(old.target);
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(old.target);
  const stopOld = addTileLayer();
  let stopNext: (() => void) | undefined = undefined;
  try {
    const switching = switchTileLayer("esri");
    stopOld();
    getMap.mockReturnValue(next.target);
    currentMap.mockReturnValue(next.target);
    stopNext = addTileLayer();
    await switching;
    expect(old.setStyle).not.toHaveBeenCalled();
    expect(next.setStyle).not.toHaveBeenCalled();
    expect(old.listenerCount()).toBe(0);
  } finally {
    stopOld();
    stopNext?.();
    getMap.mockRestore();
    currentMap.mockRestore();
  }
});

test("superseding a style switch and retiring a map settle pending callers without style.load", async () => {
  setActivePinia(createPinia());
  const { target, setStyle, listenerCount } = pendingMap();
  const getMap = spyOn(map, "getMap").mockReturnValue(target);
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(target);
  const stop = addTileLayer();
  try {
    const first = switchTileLayer("CHE");
    const second = switchTileLayer("FRA");
    await first;
    stop();
    await second;
    expect(setStyle).toHaveBeenCalledTimes(2);
    expect(listenerCount()).toBe(0);
  } finally {
    stop();
    getMap.mockRestore();
    currentMap.mockRestore();
  }
});
