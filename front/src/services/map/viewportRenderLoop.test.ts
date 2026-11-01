import { expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { LngLatBounds, type Map as MaplibreMap } from "maplibre-gl";
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

    stop();
    render.mockClear();
    overlays.updateOverlayDraft(tile.id, { caption: "After unmount" });
    await nextTick();
    expect(render).not.toHaveBeenCalled();
  } finally {
    stop();
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
  const camera: Pick<MaplibreMap, "getBounds" | "getZoom"> = { getBounds, getZoom: () => 0 };
  // Only the camera reads used by the loop are exercised; no GL rendering is simulated.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const target = camera as MaplibreMap;
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
