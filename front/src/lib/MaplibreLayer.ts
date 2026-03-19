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

import L from "leaflet";
import type { LatLngBounds, Layer as LayerType, Point as PointType } from "leaflet";
import type { Map as MaplibreMap } from "maplibre-gl";
import maplibre, { type MapOptions } from "maplibre-gl";

const { Layer, setOptions, DomEvent, DomUtil, latLngBounds, Util, extend, Point } = L;

type LeafletMaplibreGLOptions = Omit<MapOptions, "container">;

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
      resize: this._update,
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

    const size = this.getSize(),
      container = this._container,
      gl = this._glMap,
      offset = this._map.getSize().multiplyBy(this.options.padding),
      topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(offset);

    DomUtil.setPosition(container, this._roundPoint(topLeft));

    this._transformGL(gl);

    if (gl.transform.width !== size.x || gl.transform.height !== size.y) {
      container.style.width = size.x + "px";
      container.style.height = size.y + "px";
      if (gl._resize !== null && gl._resize !== undefined) {
        gl._resize();
      } else {
        gl.resize();
      }
    } else if (gl._update !== null && gl._update !== undefined) {
      // older versions of mapbox-gl surfaced update publicly
      gl._update();
    } else {
      gl.update();
    }
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
    this._glMap.jumpTo({
      zoom: this._map.getZoom() - 1,
      center: this._map.getCenter(),
    });
  },

  // borrowed from L.ImageOverlay
  // https://github.com/Leaflet/Leaflet/blob/master/src/layer/ImageOverlay.js#L139-L144
  _animateZoom: function _animateZoom(e: any) {
    const scale = this._map.getZoomScale(e.zoom);

    // Calculate where the current bounds (which match the canvas size since padding=0)
    // will be positioned at the new zoom level, relative to the new map center.
    const bounds = this.getBounds();
    const offset = this._map._latLngBoundsToNewLayerBounds(bounds, e.zoom, e.center).min;

    // The canvas is inside a container that is already translated by the rounded this._offset.
    // We must subtract the rounded this._offset so the total translation relative to the tilePane is correct.
    const containerOffset = this._roundPoint(this._offset);
    DomUtil.setTransform(this._glMap._actualCanvas, offset.subtract(containerOffset), scale);
  },

  _zoomStart: function _zoomStart(_e: any) {
    this._zooming = true;
  },

  _zoomEnd: function _zoomEnd() {
    const scale = this._map.getZoomScale(this._map.getZoom());

    DomUtil.setTransform(
      this._glMap._actualCanvas,
      // https://github.com/mapbox/mapbox-gl-leaflet/pull/130
      new Point(0, 0),
      scale,
    );

    this._zooming = false;

    this._update();
  },
});

export function maplibreLayer(options: LeafletMaplibreGLOptions): MaplibreGL {
  return new (MaplibreLayer as any)(options);
}
