// AI : Creates a proxy to the UMD Leaflet object `window.L` as a type-safe ESM export
// Based on https://stackoverflow.com/questions/73091042/importing-leaflet-into-module-from-cdn-with-typescript-support

/*
AI : Leaflet is now loaded directly in index.html to avoid critical request chaining.
This shim just provides the ESM export with TypeScript typing for the global L object.
*/

// AI : Use type-only import to avoid bundling
import type * as LeafletTypes from 'leaflet';

// AI : Get the global L object with proper typing
const { L } = window as { L: typeof LeafletTypes };

// AI : Export as default to maintain compatibility with existing imports
export default L;