// AI : Creates a proxy to the UMD Leaflet object `window.L` as a type-safe ESM export
// Based on https://stackoverflow.com/questions/73091042/importing-leaflet-into-module-from-cdn-with-typescript-support

/*
This loads (and executes) the UMD Leaflet script the first time that
this module is imported into the module graph, which assigns
the UMD Leaflet object to `window.L`. This is scope pollution, and is
one of the things that ES modules avoid, but is necessary here because
we want to use Leaflet from CDN while maintaining TypeScript support.

This proxy technique works well here because Leaflet
is an object export/namespace and is documented to be used this way.
*/

// AI : Load Leaflet from CDN
import 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// AI : Use type-only import to avoid bundling
import type * as LeafletTypes from 'leaflet';

// AI : Get the global L object with proper typing
const { L } = window as unknown as { L: typeof LeafletTypes };

// AI : Export as default to maintain compatibility with existing imports
export default L;