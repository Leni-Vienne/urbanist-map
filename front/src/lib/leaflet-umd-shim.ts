// ESM proxy for the UMD Leaflet global loaded via CDN in index.html.
// Provides TypeScript typings without bundling Leaflet.
// Based on https://stackoverflow.com/questions/73091042/importing-leaflet-into-module-from-cdn-with-typescript-support

import type * as LeafletTypes from "leaflet";

const { L } = globalThis as { L: typeof LeafletTypes };

export default L;

if (import.meta.hot) {
  import.meta.hot.accept();
}
