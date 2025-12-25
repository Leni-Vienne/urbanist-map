// AI : TypeScript declarations for leaflet-doubletapdrag and leaflet-doubletapdragzoom plugins
// AI : These plugins add double-tap drag functionality for mobile devices

import * as L from "leaflet";

declare module "leaflet-doubletapdrag";
declare module "leaflet-doubletapdragzoom";

declare module "leaflet" {
  interface MapOptions {
    // AI : Enable double-tap drag to zoom (pinch-zoom alternative)
    doubleTapDragZoom?: boolean | "center";
    doubleTapDragZoomOptions?: {
      reverse?: boolean;
    };
  }
}
