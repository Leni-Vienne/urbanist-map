/**
 * ESM-compatible maplibre-gl-leaflet bridge.
 *
 * The official @maplibre/maplibre-gl-leaflet package is a UMD module that
 * expects a global `L` at evaluation time, which breaks when Vite bundles it
 * because our Leaflet is loaded from a CDN script tag.
 *
 * This file imports Leaflet's named exports (resolved through our CDN shim)
 * so everything works in the ESM/Vite world without relying on globals.
 *
 * Based on https://github.com/maplibre/maplibre-gl-leaflet (MIT license).
 */

import L, { type LatLngBounds, type Layer as LayerType, type Point as PointType } from "leaflet";
import maplibre, { type Map as MaplibreMap, type MapOptions } from "maplibre-gl";

const { Layer, setOptions, DomUtil, latLngBounds, Util, extend, Point } = L;

type LeafletMaplibreGLOptions = Omit<MapOptions, "container"> & {
  pane?: string;
};

export interface MaplibreGL extends LayerType {
  getMaplibreMap(): MaplibreMap;
  getCanvas(): HTMLCanvasElement;
  getSize(): PointType;
  getBounds(): LatLngBounds;
  getContainer(): HTMLDivElement;
  getPaneName(): string;
}

const MaplibreLayer = Layer.extend({
  options: {
    updateInterval: 32,
    // How much to extend the overlay view (relative to map size)
    // e.g. 0.1 would be 10% of map view in each direction
    padding: 0,
    // whether or not to register the mouse and keyboard
    // events on the maplibre overlay
    interactive: false,
    // set the tilepane as the default pane to draw gl tiles
    pane: "tilePane",
  },

  initialize: function initialize(options: any) {
    setOptions(this, options);

    // setup throttling the update event when panning
    this._throttledUpdate = Util.throttle(this._update, this.options.updateInterval, this);
  },

  onAdd: function onAdd(map: any) {
    if (!this._container) {
      this._initContainer();
    }

    const paneName = this.getPaneName();
    map.getPane(paneName)!.appendChild(this._container);

    this._initGL();

    this._offset = this._map.containerPointToLayerPoint([0, 0]);
  },

  onRemove: function onRemove(map: any) {
    const paneName = this.getPaneName();
    map.getPane(paneName).removeChild(this._container);

    this._glMap.remove();
    this._glMap = null;
  },

  getEvents: function getEvents() {
    return {
      move: this._throttledUpdate, // sensibly throttle updating while panning
      zoomanim: this._animateZoom, // applies the zoom animation to the <canvas>
      zoom: this._pinchZoom, // animate every zoom event for smoother pinch-zooming
      zoomstart: this._zoomStart, // flag starting a zoom to disable panning
      zoomend: this._zoomEnd,
      resize: this._resize,
      // Forward Leaflet movement onto the MapLibre map as "leaflet-movestart" /
      // "leaflet-moveend" so consumers can detect Leaflet camera movement via
      // getMlMap() without knowing about the bridge. Standard "movestart"/"moveend"
      // names cannot be used: MapLibre fires those itself for every jumpTo() call
      // (once per throttled drag frame), which would reset any moving flag each frame.
      movestart: this._forwardMoveStart,
      moveend: this._forwardMoveEnd,
    };
  },

  getMaplibreMap: function getMaplibreMap() {
    return this._glMap;
  },

  getCanvas: function getCanvas() {
    return this._glMap.getCanvas();
  },

  getSize: function getSize() {
    return this._map
      .getSize()
      .multiplyBy(1 + this.options.padding * 2)
      .round();
  },

  getBounds: function getBounds() {
    const halfSize = this.getSize().multiplyBy(0.5);
    const center = this._map.latLngToContainerPoint(this._map.getCenter());
    return latLngBounds(
      this._map.containerPointToLatLng(center.subtract(halfSize)),
      this._map.containerPointToLatLng(center.add(halfSize)),
    );
  },

  getContainer: function getContainer() {
    return this._container;
  },

  // returns the pane name set in options if it is a valid pane, defaults to tilePane
  getPaneName: function getPaneName() {
    return this._map.getPane(this.options.pane) ? this.options.pane : "tilePane";
  },

  _roundPoint: function _roundPoint(p: any) {
    return { x: Math.round(p.x), y: Math.round(p.y) };
  },

  _initContainer: function _initContainer() {
    const container = (this._container = DomUtil.create("div", "leaflet-gl-layer"));

    const size = this.getSize();
    const offset = this._map.getSize().multiplyBy(this.options.padding);
    container.style.width = size.x + "px";
    container.style.height = size.y + "px";

    const topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(offset);

    DomUtil.setPosition(container, this._roundPoint(topLeft));
  },

  _initGL: function _initGL() {
    const center = this._map.getCenter();

    const options = extend({}, this.options, {
      container: this._container,
      center: [center.lng, center.lat],
      zoom: this._map.getZoom() - 1,
      attributionControl: false,
    });

    this._glMap = new maplibre.Map(options);

    // Allow MapLibre to pan/zoom beyond Mercator limits so it stays in sync
    // with Leaflet at low zoom levels where the canvas exceeds the world bounds.
    // Without this, MapLibre clamps to a fractional minimum zoom (e.g. 1.11)
    // causing a visual snap at the end of Leaflet's CSS zoom animation.
    const tr = this._glMap.transform;
    // MapLibre v5+
    if (tr._helper) {
      if (tr._helper._latRange !== undefined) tr._helper._latRange = [-Infinity, Infinity];
      if (tr._helper._minZoom !== undefined) tr._helper._minZoom = -2;
    }

    this._transformGL(this._glMap);

    if (this._glMap._canvas.canvas) {
      // older versions of mapbox-gl surfaced the canvas differently
      this._glMap._actualCanvas = this._glMap._canvas.canvas;
    } else {
      this._glMap._actualCanvas = this._glMap._canvas;
    }

    // treat child <canvas> element like L.ImageOverlay
    const canvas = this._glMap._actualCanvas;
    DomUtil.addClass(canvas, "leaflet-image-layer");
    DomUtil.addClass(canvas, "leaflet-zoom-animated");
    if (this.options.interactive) {
      DomUtil.addClass(canvas, "leaflet-interactive");
    }
    if (this.options.className) {
      DomUtil.addClass(canvas, this.options.className);
    }
  },

  _update: function _update(_e: any) {
    // update the offset so we can correct for it later when we zoom
    this._offset = this._map.containerPointToLayerPoint([0, 0]);

    if (this._zooming) {
      return;
    }

    const offset = this._map.getSize().multiplyBy(this.options.padding),
      topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(offset);

    DomUtil.setPosition(this._container, this._roundPoint(topLeft));
    this._transformGL(this._glMap);
  },

  _resize: function _resize() {
    const size = this.getSize();
    this._container.style.width = size.x + "px";
    this._container.style.height = size.y + "px";

    // Debounce the actual GL canvas resize to avoid per-frame canvas clears
    // (changing canvas dimensions clears it synchronously, causing a blank frame).
    // The container is already the right size so layout is correct immediately.
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      const gl = this._glMap;
      if (gl._resize !== null && gl._resize !== undefined) {
        gl._resize();
      } else {
        gl.resize();
      }
      this._update();
    }, 100);
  },

  _transformGL: function _transformGL(gl: any) {
    const center = this._map.getCenter();

    // Maplibre GL JS v5+ makes `transform` strictly readonly.
    // Instead of mutating `gl.transform`, we must use `jumpTo()`.
    gl.jumpTo({
      center: [center.lng, center.lat],
      zoom: this._map.getZoom() - 1,
    });
  },

  // update the map constantly during a pinch zoom
  _pinchZoom: function _pinchZoom(_e: any) {
    // Don't update MapLibre during CSS-animated zooms (scroll wheel, double-click)
    // as it changes the canvas content mid-animation, causing visual glitches.
    if (this._zooming) {
      return;
    }
    this._glMap.jumpTo({
      zoom: this._map.getZoom() - 1,
      center: this._map.getCenter(),
    });
  },

  // borrowed from L.ImageOverlay
  // https://github.com/Leaflet/Leaflet/blob/master/src/layer/ImageOverlay.js#L139-L144
  _animateZoom: function _animateZoom(e: any) {
    this._zooming = true;
    const scale = this._map.getZoomScale(e.zoom);

    // Work in world pixel coords (like GridLayer._setZoomTransform) to avoid
    // lat/lng clamping at low zoom levels where the canvas extends beyond the Mercator bounds.
    const containerPos = DomUtil.getPosition(this._container);
    const pixelOrigin = this._map.getPixelOrigin();
    const newPixelOrigin = this._map._getNewPixelOrigin(e.center, e.zoom);
    const canvasWorldPos = pixelOrigin.add(containerPos);
    const offset = canvasWorldPos.multiplyBy(scale).subtract(newPixelOrigin).subtract(containerPos);

    DomUtil.setTransform(this._glMap._actualCanvas, offset, scale);
  },

  _forwardMoveStart: function _forwardMoveStart(this: any) {
    this._glMap.fire("leaflet-movestart");
  },
  _forwardMoveEnd: function _forwardMoveEnd(this: any) {
    this._glMap.fire("leaflet-moveend");
  },

  _zoomStart: function _zoomStart(_e: any) {},

  _zoomEnd: function _zoomEnd() {
    // Reset canvas CSS transform to identity (getZoomScale of current zoom = 1)
    DomUtil.setTransform(this._glMap._actualCanvas, new Point(0, 0), 1);

    this._zooming = false;
    this._update();
  },
});

export function maplibreLayer(options: LeafletMaplibreGLOptions): MaplibreGL {
  return new (MaplibreLayer as any)(options);
}
