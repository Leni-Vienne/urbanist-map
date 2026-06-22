import { ref } from "vue";
import type { Map as MaplibreMap, ExpressionSpecification } from "maplibre-gl";
import { getMlMap } from "@/services/core/map";

const STORAGE_KEY = "urbanist-map-label-lang";

// "auto" follows the browser language, "default" keeps OpenFreeMap's own labels
// (Latin transliteration + local script), "local" shows each place's native name,
// any other value is a concrete OSM name:<code> language (e.g. "ja", "de").
export type MapLabelLanguage = "auto" | "default" | "local" | (string & {});

/** The browser's primary language as a bare OSM name:<code> language (e.g. "ja", "de"). */
export function getBrowserLanguageCode(): string {
  return navigator.language.split("-")[0] || "en";
}

/** The browser language's own endonym (e.g. "日本語", "Deutsch"), for labelling the picker. */
export function getBrowserLanguageName(): string {
  const code = getBrowserLanguageCode();
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
function readStoredPreference(): MapLabelLanguage {
  return localStorage.getItem(STORAGE_KEY) ?? "auto";
}

// Liberty's label layers default to local/native names. We rewrite their text-field to
// prefer the chosen language, falling back to the local Latin name then the raw OSM name
// so untranslated places still render.
let currentPreference: MapLabelLanguage = readStoredPreference();

// Reactive mirror of the preference so views (e.g. the project location breadcrumb) re-localize when
// the map language changes, the same way they react to the UI locale.
export const mapLabelLanguageRef = ref<MapLabelLanguage>(currentPreference);

type BoundaryNameVariants = {
  name: string; // OSM `name` (native/local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // all `name:*` variants, keyed by OSM language code
};

// Pick a boundary's display name honouring the map label language, falling back to the UI locale,
// then English, then the native name. "local" forces the native name; "default" defers to the UI
// locale (the breadcrumb's prior behaviour); "auto"/explicit codes use that OSM name:<code> first,
// so a zh user finally gets Chinese names that the en/fr-only UI locale could never provide.
export function pickBoundaryName(
  entry: BoundaryNameVariants,
  preference: MapLabelLanguage,
  uiLocale: string,
): string {
  if (preference === "local") return entry.name;
  let code: string | null = null;
  if (preference === "auto") {
    code = getBrowserLanguageCode();
  } else if (preference !== "default") {
    code = preference;
  }
  const byMapLanguage = code ? entry.names?.[code] : undefined;
  return byMapLanguage ?? entry.names?.[uiLocale] ?? entry.nameEn ?? entry.name;
}

// Each label layer's untouched text-field, captured the first time we override it, so the
// "default" mode can restore OpenFreeMap's exact labels. Liberty's layers are identical
// across style reloads, so a cached original stays valid after satellite/plan switches.
const originalTextFields = new Map<string, unknown>();

// Resolve the preference to the OSM name:<code> language to render, or null for native names.
function resolveLanguageCode(preference: MapLabelLanguage): string | null {
  if (preference === "local") return null;
  if (preference === "auto") return getBrowserLanguageCode();
  return preference;
}

function buildNameExpression(preference: MapLabelLanguage): ExpressionSpecification {
  const code = resolveLanguageCode(preference);
  if (code === null) {
    return ["coalesce", ["get", "name"], ["get", "name:latin"]];
  }
  const translated: ExpressionSpecification = [
    "coalesce",
    ["get", `name:${code}`],
    ["get", "name:latin"],
    ["get", "name"],
  ];
  // Add the place's native name on a second, smaller line, but only when that name is in a
  // non-Latin script. We approximate "non-Latin" by the native `name` differing from its Latin
  // transliteration `name:latin`, so e.g. "Tokyo / 東京" gets the local line while "Paris" or
  // "Munich / München" (already Latin) stays single-line and uncluttered.
  return [
    "case",
    ["all", ["has", "name:latin"], ["!=", ["get", "name"], ["get", "name:latin"]]],
    ["format", translated, {}, "\n", {}, ["get", "name"], { "font-scale": 0.75 }],
    ["format", translated, {}],
  ];
}

// A text-field worth localizing references an OSM name. House numbers, road shields
// (ref), elevations, etc. don't mention "name", so they are left untouched.
function textFieldReferencesName(field: unknown): boolean {
  return JSON.stringify(field ?? "").includes("name");
}

export function getMapLabelLanguage(): MapLabelLanguage {
  return currentPreference;
}

/**
 * Rewrite the basemap's name labels to the chosen language. Called from the style.load
 * handlers (where getStyle().layers is populated) and from the picker, so it does not
 * guard on isStyleLoaded() (that can still report false right after style.load).
 */
export function applyMapLabelLanguage(
  mlMap: MaplibreMap,
  preference: MapLabelLanguage = currentPreference,
): void {
  const useStyleDefault = preference === "default";
  const nameExpression = useStyleDefault ? null : buildNameExpression(preference);

  for (const layer of mlMap.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const textField = mlMap.getLayoutProperty(layer.id, "text-field");
    if (!textFieldReferencesName(textField)) continue;

    // Capture the original before the first override so "default" can restore it later.
    if (!originalTextFields.has(layer.id)) {
      originalTextFields.set(layer.id, textField);
    }

    const value = useStyleDefault ? originalTextFields.get(layer.id) : nameExpression;
    mlMap.setLayoutProperty(layer.id, "text-field", value);
  }
}

/** Persist the map label language preference and apply it to the live map if one exists. */
export function setMapLabelLanguage(preference: MapLabelLanguage): void {
  currentPreference = preference;
  mapLabelLanguageRef.value = preference;
  localStorage.setItem(STORAGE_KEY, preference);
  const mlMap = getMlMap();
  if (mlMap) applyMapLabelLanguage(mlMap, preference);
}
