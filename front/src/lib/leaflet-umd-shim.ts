// AI : Creates a proxy to the UMD Leaflet object `globalThis.L` as a type-safe ESM export
// Based on https://stackoverflow.com/questions/73091042/importing-leaflet-into-module-from-cdn-with-typescript-support

/*
AI : Leaflet is now loaded directly in index.html to avoid critical request chaining.
This shim just provides the ESM export with TypeScript typing for the global L object.
*/

// AI : Use type-only import to avoid bundling
import type * as LeafletTypes from "leaflet";

// AI : Get the global L object with proper typing
const { L } = globalThis as { L: typeof LeafletTypes };

// AI : Export as default to maintain compatibility with existing imports
export default L;

// AI : Accept HMR updates to prevent full page reload
// AI : This is crucial because this shim is imported by many files
// AI : Without this, any change to files importing Leaflet triggers a full reload
if (import.meta.hot) {
  import.meta.hot.accept();
}
