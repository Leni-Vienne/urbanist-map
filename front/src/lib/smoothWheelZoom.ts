/**
 * Device-adaptive scroll-wheel zoom for Leaflet.
 *
 * No web API distinguishes trackpad from mouse, so each gesture is classified by its
 * delta shape: large/integer/line-mode reads as mouse, small/fractional/pixel-mode (or
 * ctrl+wheel pinch) reads as trackpad. The class is locked for the gesture.
 *
 * Mouse gestures fall through to Leaflet's built-in scrollWheelZoom. Trackpad gestures
 * are claimed via stopImmediatePropagation and driven as a requestAnimationFrame-eased
 * zoom through map._move(), the same path pinch zoom uses. The ease keeps running after
 * the wheel stops until it reaches the target.
 *
 * The listener is bubble phase so child panels using disableScrollPropagation still
 * suppress map zoom; the built-in handler is re-registered so ours runs first.
 *
 * Registers a `smoothWheelZoom` map option (on once imported); keep `scrollWheelZoom`
 * enabled for the mouse path. Raise `smoothSensitivity` for faster trackpad zoom.
 *
 * Technique from Leaflet.SmoothWheelZoom (MIT).
 */

/* oxlint-disable no-underscore-dangle */
import L from "leaflet";

const { Handler, DomEvent } = L;

// MOUSE_MIN_DELTA is the trackpad/mouse threshold in pixels; the rest tune the trackpad
// ease only (mouse uses Leaflet's own path).
const MOUSE_MIN_DELTA = 40;
const ZOOM_PER_DELTA = 0.025; // wheel delta to zoom scale
const MAX_STEP = 0.5; // max zoom change per event
const EASE = 0.25; // per-frame approach to target
const SETTLE = 0.002; // snap distance onto target
const IDLE_MS = 150; // gesture-end timeout

function isTrackpadGesture(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return false; // line/page units come from a real wheel
  if (e.ctrlKey) return true; // trackpad pinch-zoom arrives as ctrl + wheel
  if (!Number.isInteger(e.deltaY)) return true; // fractional delta means a trackpad
  return Math.abs(e.deltaY) < MOUSE_MIN_DELTA; // small pixel delta means a trackpad
}

const SmoothWheelZoom = Handler.extend({
  addHooks: function addHooks() {
    DomEvent.on(this._map._container, "wheel", this._onWheel, this);
    const builtin = this._map.scrollWheelZoom;
    if (builtin && builtin.enabled()) {
      builtin.disable();
      builtin.enable();
    }
  },

  removeHooks: function removeHooks() {
    DomEvent.off(this._map._container, "wheel", this._onWheel, this);
    this._finalizeEase();
    clearTimeout(this._idleTimer);
  },

  _onWheel: function _onWheel(e: WheelEvent) {
    // A deltaY of 0/-0 carries no zoom intent. Browsers emit one at the end of a trackpad
    // pinch; Leaflet's getWheelDelta then falls back to the legacy wheelDelta (~±120) and
    // reports a large bogus delta.
    if (!e.deltaY) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const map = this._map;

    const fresh = !this._gestureClass;
    if (fresh) {
      this._gestureClass = isTrackpadGesture(e) ? "trackpad" : "mouse";
    }

    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(this._endGesture.bind(this), IDLE_MS);

    if (this._gestureClass === "mouse") {
      if (this._frame) {
        this._finalizeEase();
      }
      return; // handled by Leaflet's built-in scrollWheelZoom
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    const raw = DomEvent.getWheelDelta(e);
    if (raw === 0) return;

    if (!this._active) {
      this._active = true;
      this._committed = false;
      if (this._frame) cancelAnimationFrame(this._frame);
      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      this._centerPoint = map.getSize().divideBy(2);
      this._anchorLatLng = map.containerPointToLatLng(map.mouseEventToContainerPoint(e));
      map._stop();
      // Take the built-in wheel handler fully out of play so it can't also zoom
      // (its zoomSnap-quantized step would fight this ease). Restored on gesture end.
      const builtin = map.scrollWheelZoom;
      if (builtin && builtin.enabled()) {
        this._builtinDisabled = true;
        builtin.disable();
      }
      this._frame = requestAnimationFrame(this._tick.bind(this));
    }

    const sensitivity = map.options.smoothSensitivity ?? 1;
    const step = Math.sign(raw) * Math.min(Math.abs(raw) * ZOOM_PER_DELTA * sensitivity, MAX_STEP);
    this._goalZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), this._goalZoom + step));
    this._mousePoint = map.mouseEventToContainerPoint(e);
  },

  _endGesture: function _endGesture() {
    this._gestureClass = null;
    this._active = false; // a running ease settles onto the target, then finalizes
  },

  _finalizeEase: function _finalizeEase() {
    if (this._frame) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    if (this._committed) {
      this._committed = false;
      this._map._moveEnd(true);
    }
    this._active = false;
    if (this._builtinDisabled) {
      this._builtinDisabled = false;
      const builtin = this._map.scrollWheelZoom;
      if (builtin && !builtin.enabled()) builtin.enable();
    }
  },

  _tick: function _tick() {
    const map = this._map;

    // Another handler moved the map: abort and let it own the view.
    if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
      this._finalizeEase();
      return;
    }

    let zoom = map.getZoom() + (this._goalZoom - map.getZoom()) * EASE;
    const reached = Math.abs(this._goalZoom - zoom) < SETTLE;
    if (reached) zoom = this._goalZoom;
    zoom = Math.round(zoom * 1000) / 1000;

    // Keep the point that was under the cursor anchored while zooming toward it.
    const offset = this._mousePoint.subtract(this._centerPoint);
    const center = map.unproject(map.project(this._anchorLatLng, zoom).subtract(offset), zoom);

    if (!this._committed) {
      map._moveStart(true, false);
      this._committed = true;
    }
    map._move(center, zoom);
    this._prevCenter = map.getCenter();
    this._prevZoom = map.getZoom();

    if (!this._active && reached) {
      this._finalizeEase();
      return;
    }
    this._frame = requestAnimationFrame(this._tick.bind(this));
  },
});

(L.Map as any).mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });
(L.Map as any).addInitHook("addHandler", "smoothWheelZoom", SmoothWheelZoom);
