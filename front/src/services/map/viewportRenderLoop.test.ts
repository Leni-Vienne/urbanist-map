// These unit tests supply only the MapLibre methods each protocol uses; no GL map is constructed.
// oxlint-disable anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion
import { expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { Evented, LngLatBounds, type Map as MaplibreMap } from "maplibre-gl";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import type { TileOverlayData } from "@/types/index";

// Map modules read the viewport on import; these tests do not mount a browser map.
const originalMatchMedia = globalThis.matchMedia;
globalThis.matchMedia = (media) =>
  Object.assign(new EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
const { createViewportRenderLoop, watchOverlayReconciliation } =
  await import("./viewportRenderLoop");
const map = await import("@/services/core/map");
const registry = await import("@/services/overlay/mapLayers");
const { initVectorTileSync } = await import("./tiles/sync");
globalThis.matchMedia = originalMatchMedia;

const tile: TileOverlayData = {
  id: "overlay",
  projectId: null,
  filename: "image.webp",
  caption: null,
  status: "approved",
  centroid: { lat: 0.5, lng: 0.5 },
  baselineCaption: null,
  baselineCorners: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 0 },
  ],
};

test("tile arrivals, selection and draft history request rendering without a mode session", async () => {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "user",
    email: "user@example.com",
    username: "User",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
  const overlays = useOverlayStore();
  const render = mock(() => undefined);
  const stop = watchOverlayReconciliation(render);

  async function expectRender(change: () => void): Promise<void> {
    render.mockClear();
    change();
    await nextTick();
    expect(render).toHaveBeenCalled();
  }

  try {
    await expectRender(() => overlays.replaceTileOverlays(new Map([[tile.id, tile]])));
    await expectRender(() =>
      useFocusStore().setSelectionTarget({ kind: "overlay", overlayId: tile.id, projectId: null }),
    );
    await expectRender(() => useUiStore().setMode("edit"));

    const overlay = overlays.getOverlayById(tile.id);
    if (!overlay) throw new Error("Tile overlay was not ingested");
    const originalCorners = tile.baselineCorners;
    const editedCorners = originalCorners.map((corner) => ({ ...corner, lng: corner.lng + 1 }));
    await expectRender(() =>
      overlays.commitHistory(tile.id, [
        { corners: originalCorners, imageUrl: overlay.imageUrl },
        { corners: editedCorners, imageUrl: overlay.imageUrl },
      ]),
    );
    await expectRender(() => {
      overlays.undoHistory(tile.id);
    });
    await expectRender(() => {
      overlays.redoHistory(tile.id);
    });
    await expectRender(() =>
      overlays.addLocalOverlay("local", { ...overlay, id: "local", status: null }),
    );

    await expectRender(() => overlays.removeOverlay("local"));

    stop();
    render.mockClear();
    overlays.updateOverlayDraft(tile.id, { caption: "After unmount" });
    await nextTick();
    expect(render).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test("stopping tile sync cancels its trailing update while the map is still alive", async () => {
  setActivePinia(createPinia());
  const querySourceFeatures = mock(() => []);
  const target = Object.assign(new (class extends Evented {})(), {
    getLayer: () => ({}),
    querySourceFeatures,
  }) as unknown as MaplibreMap;
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(target);
  const stop = initVectorTileSync(target);
  try {
    target.fire("move");
    stop();
    await Bun.sleep(170);
    expect(querySourceFeatures).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    currentMap.mockRestore();
  }
});

test("map teardown cancels queued rendering and ignores late camera refreshes", () => {
  setActivePinia(createPinia());
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const originalRequestFrame = globalThis.requestAnimationFrame;
  const originalCancelFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frameId += 1;
    frames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const getBounds = mock(() => new LngLatBounds([-1, -1], [1, 1]));
  let styleReady = true;
  const camera = {
    getBounds,
    getZoom: () => 0,
    getSource: (): object | undefined => (styleReady ? {} : undefined),
  };
  // Only the camera reads used by the loop are exercised; no GL rendering is simulated.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const target = camera as unknown as MaplibreMap;
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(target);
  const loop = createViewportRenderLoop(target, () => undefined);

  try {
    loop.run();
    loop.run();
    expect(frames.size).toBe(1);
    loop.stop();
    loop.run();
    expect(frames.size).toBe(0);

    const nextLoop = createViewportRenderLoop(target, () => undefined);
    try {
      styleReady = false;
      nextLoop.run();
      for (const callback of frames.values()) callback(0);
      frames.clear();
      expect(getBounds).not.toHaveBeenCalled();
      styleReady = true;
      nextLoop.run();
      for (const callback of frames.values()) callback(0);
      frames.clear();
      expect(getBounds).toHaveBeenCalledTimes(1);
      loop.run();
      expect(frames.size).toBe(0);
    } finally {
      nextLoop.stop();
    }
  } finally {
    loop.stop();
    currentMap.mockRestore();
    globalThis.requestAnimationFrame = originalRequestFrame;
    globalThis.cancelAnimationFrame = originalCancelFrame;
  }
});

test("queued viewport removal preserves an overlay whose gesture started before the queue drained", () => {
  setActivePinia(createPinia());
  const frames: FrameRequestCallback[] = [];
  const originalRequestFrame = globalThis.requestAnimationFrame;
  const originalCancelFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.cancelAnimationFrame = () => undefined;
  // Low zoom queues existing objects without creating any map sources or GL layers.
  const target = {
    getBounds: () => new LngLatBounds([-1, -1], [1, 1]),
    getZoom: () => 0,
    getSource: (): object | undefined => ({}),
  } as unknown as MaplibreMap;
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue(target);
  const remove = mock(() => {});
  registry.setMarker("dragged", { remove } as unknown as NonNullable<
    ReturnType<typeof registry.getMarker>
  >);
  const loop = createViewportRenderLoop(target, () => undefined);
  try {
    loop.run();
    frames.shift()?.(0);
    registry.takeGestureOwnership("dragged", {
      center: { lat: 0, lng: 0 },
      width: 10,
      height: 10,
      bearing: 0,
    });
    frames.shift()?.(0);
    expect(remove).not.toHaveBeenCalled();
    expect(registry.isGestureOwned("dragged")).toBeTrue();
  } finally {
    loop.stop();
    registry.clearEntry("dragged");
    currentMap.mockRestore();
    globalThis.requestAnimationFrame = originalRequestFrame;
    globalThis.cancelAnimationFrame = originalCancelFrame;
  }
});
