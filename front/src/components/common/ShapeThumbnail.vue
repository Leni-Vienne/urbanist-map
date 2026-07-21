<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 100 100"
    class="shrink-0 text-primary-color"
    :aria-hidden="title ? undefined : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <template v-if="shapes">
      <polygon
        v-for="(ring, i) in shapes.rings"
        :key="`r${i}`"
        :points="ring"
        fill="currentColor"
        fill-opacity="0.18"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <polyline
        v-for="(line, i) in shapes.lines"
        :key="`l${i}`"
        :points="line"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle
        v-for="(pt, i) in shapes.points"
        :key="`p${i}`"
        :cx="pt[0]"
        :cy="pt[1]"
        r="3"
        fill="currentColor"
      />
    </template>
    <!-- Fallback marker dot for point-only or empty geometries -->
    <circle v-else cx="50" cy="50" r="4" fill="currentColor" fill-opacity="0.5" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

type Position = [number, number];

const props = withDefaults(
  defineProps<{
    geometry: GeoJSON.GeometryCollection | GeoJSON.Geometry | null | undefined;
    size?: number;
    title?: string;
  }>(),
  { size: 36, title: "" },
);

const PADDING = 8;

// Recursively collect every [lng, lat] position out of an arbitrarily nested coordinates array.
function collectPositions(coords: unknown): Position[] {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    return [[coords[0], coords[1] as number]];
  }
  if (Array.isArray(coords)) {
    return coords.flatMap((c) => collectPositions(c));
  }
  return [];
}

function flattenGeometries(
  geometry: GeoJSON.Geometry,
): Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>[] {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap((g) => flattenGeometries(g));
  }
  return [geometry];
}

type Projector = (position: Position) => Position;
type FlatGeometry = Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>;
interface Drawables {
  rings: string[];
  lines: string[];
  points: Position[];
}

// Build a [0..100] viewBox projector that fits the bbox of all positions, preserving aspect ratio.
function makeProjector(positions: Position[]): Projector {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of positions) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((100 - 2 * PADDING) / spanX, (100 - 2 * PADDING) / spanY);
  const offsetX = (100 - spanX * scale) / 2;
  const offsetY = (100 - spanY * scale) / 2;
  return function project([lng, lat]: Position): Position {
    // Flip Y: latitude grows upward, SVG Y grows downward.
    return [offsetX + (lng - minX) * scale, 100 - (offsetY + (lat - minY) * scale)];
  };
}

function toPoints(ring: Position[], project: Projector): string {
  return ring
    .map((p) => {
      const [x, y] = project(p);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildDrawables(parts: FlatGeometry[], project: Projector): Drawables {
  const rings: string[] = [];
  const lines: string[] = [];
  const points: Position[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "Polygon":
        for (const ring of part.coordinates) rings.push(toPoints(ring as Position[], project));
        break;
      case "MultiPolygon":
        for (const polygon of part.coordinates)
          for (const ring of polygon) rings.push(toPoints(ring as Position[], project));
        break;
      case "LineString":
        lines.push(toPoints(part.coordinates as Position[], project));
        break;
      case "MultiLineString":
        for (const line of part.coordinates) lines.push(toPoints(line as Position[], project));
        break;
      case "Point":
        points.push(project(part.coordinates as Position));
        break;
      case "MultiPoint":
        for (const pt of part.coordinates) points.push(project(pt as Position));
        break;
      default:
        break;
    }
  }
  return { rings, lines, points };
}

const shapes = computed(() => {
  const geometry = props.geometry;
  if (!geometry) return null;

  const parts = flattenGeometries(geometry);
  const allPositions = parts.flatMap((g) => collectPositions(g.coordinates));
  if (allPositions.length === 0) return null;

  const drawables = buildDrawables(parts, makeProjector(allPositions));
  if (drawables.rings.length === 0 && drawables.lines.length === 0 && drawables.points.length === 0)
    return null;
  return drawables;
});
</script>
