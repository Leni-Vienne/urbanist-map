import { createHash } from "node:crypto";

interface RevisionFeature {
  id?: string | number | null;
  properties?: unknown;
  geometry?: unknown;
}

const UNORDERED_ARRAY_KEYS = new Set(["osm_ids"]);

export function computeOsmFeatureRevision(feature: RevisionFeature): string {
  const canonicalFeature = canonicalize({
    id: feature.id ?? null,
    properties: feature.properties ?? null,
    geometry: feature.geometry ?? null,
  });

  return createHash("sha256").update(JSON.stringify(canonicalFeature)).digest("hex");
}

export function shouldSkipOsmFeature(
  storedRevision: string | null | undefined,
  incomingRevision: string,
  fullReimport: boolean,
): boolean {
  return !fullReimport && storedRevision === incomingRevision;
}

function canonicalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return key && UNORDERED_ARRAY_KEYS.has(key) ? items.sort(compareCanonicalValues) : items;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value).sort()) {
      result[objectKey] = canonicalize((value as Record<string, unknown>)[objectKey], objectKey);
    }
    return result;
  }

  return value;
}

function compareCanonicalValues(a: unknown, b: unknown): number {
  const serializedA = JSON.stringify(a) ?? "undefined";
  const serializedB = JSON.stringify(b) ?? "undefined";
  if (serializedA < serializedB) return -1;
  if (serializedA > serializedB) return 1;
  return 0;
}
