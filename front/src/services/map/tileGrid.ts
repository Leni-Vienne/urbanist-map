// Tile zoom inputs are MapLibre zoom (= Leaflet zoom - 1).

// Mirrors the cell_size lookup in tiles.sql. Must be a power of 2 that divides 4096
// evenly, otherwise partial stub cells at tile edges break cross-tile cluster alignment.
export function getGridCellSizeForTileZoom(tileZoom: number): number {
  if (tileZoom <= 4) return 1024;
  if (tileZoom <= 6) return 512;
  if (tileZoom <= 12) return 256;
  return 128;
}

export function tileToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tilePxToLngLat(
  tileX: number,
  tileY: number,
  px: number,
  py: number,
  z: number,
): [number, number] {
  const lng = tileToLng(tileX + px / 4096, z);
  const lat = tileToLat(tileY + py / 4096, z);
  return [lng, lat];
}
