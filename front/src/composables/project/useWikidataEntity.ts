import { computed, ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";

interface WikidataEntity {
  description: string | null;
  /** P154: logo image URL (Wikimedia Commons) */
  logoUrl: string | null;
  /** P18: main image URL (Wikimedia Commons) */
  imageUrl: string | null;
}

// Module-level session cache keyed by "Q123:en", persists across component mounts
const cache = new Map<string, WikidataEntity | null>();
// In-flight promise cache to avoid duplicate requests for the same id+lang
const pending = new Map<string, Promise<WikidataEntity | null>>();

function commonsUrl(filename: string): string {
  return (
    "https://commons.wikimedia.org/wiki/Special:FilePath/" +
    encodeURIComponent(filename.replace(/ /g, "_"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Wikidata data model, simplified:
//   entity.claims , object keyed by property ID (e.g. "P18"), each value is an array of statements
//   statement.mainsnak , the "snak" (property + value pair) that holds the actual data
//   snak.snaktype , "value" | "novalue" | "somevalue"; we only care about "value"
//   snak.datavalue, { type: "string" | "quantity" | "wikibase-entityid" | …, value: … }

// P154 = logo image (Wikimedia Commons filename)
// P18  = main image (Wikimedia Commons filename)
function getStringClaim(claims: Record<string, unknown>, property: string): string | null {
  const arr = claims[property];
  const statement = Array.isArray(arr) ? arr[0] : undefined;
  if (!isRecord(statement)) return null;
  const snak = statement.mainsnak;
  if (!isRecord(snak) || snak.snaktype !== "value") return null;
  const dv = snak.datavalue;
  if (!isRecord(dv) || dv.type !== "string") return null;
  return typeof dv.value === "string" ? dv.value : null;
}

async function fetchEntity(id: string, lang: string): Promise<WikidataEntity | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${encodeURIComponent(id)}&props=descriptions|claims` +
    `&format=json&origin=*&languages=${lang}|en`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data) || !isRecord(data.entities)) return null;
    const entity = data.entities[id];
    if (!isRecord(entity) || "missing" in entity) return null;

    const descriptions = isRecord(entity.descriptions) ? entity.descriptions : {};
    const descEntry = descriptions[lang];
    const descEnEntry = descriptions.en;
    const description =
      (isRecord(descEntry) && typeof descEntry.value === "string" ? descEntry.value : null) ??
      (isRecord(descEnEntry) && typeof descEnEntry.value === "string" ? descEnEntry.value : null);

    const claims = isRecord(entity.claims) ? entity.claims : {};
    const logoFilename = getStringClaim(claims, "P154");
    const imageFilename = getStringClaim(claims, "P18");

    return {
      description,
      logoUrl: logoFilename ? commonsUrl(logoFilename) : null,
      imageUrl: imageFilename ? commonsUrl(imageFilename) : null,
    };
  } catch {
    return null;
  }
}

function extractWikidataId(externalProperties: unknown): string | null {
  if (!externalProperties || typeof externalProperties !== "object") return null;
  const id = (externalProperties as Record<string, unknown>).wikidata;
  return typeof id === "string" ? id : null;
}

/**
 * Fetch and cache Wikidata entity data (description, logo, image).
 * Takes a project's `externalProperties` and derives the Wikidata Q-id from it.
 * Results are cached for the session so each Q-id is fetched at most once per locale.
 */
export function useWikidataEntity(externalProperties: Ref<unknown>) {
  const { locale } = useI18n();
  const entity = ref<WikidataEntity | null>(null);
  const wikidataId = computed(() => extractWikidataId(externalProperties.value));

  watch(
    [wikidataId, locale],
    async ([id, lang], _prev, onCleanup) => {
      // Marked stale when the watcher re-fires before this async run resolves, so a slow response
      // for a previous id/lang never overwrites the value for the current selection.
      let stale = false;
      onCleanup(() => {
        stale = true;
      });

      if (!id) {
        entity.value = null;
        return;
      }

      const cacheKey = `${id}:${lang}`;

      if (cache.has(cacheKey)) {
        entity.value = cache.get(cacheKey) ?? null;
        return;
      }

      // Re-use an in-flight request for the same key
      const inflight = pending.get(cacheKey);
      if (inflight) {
        const result = await inflight;
        // oxlint-disable-next-line no-unnecessary-condition
        if (!stale) entity.value = result;
        return;
      }

      const promise = fetchEntity(id, lang);
      pending.set(cacheKey, promise);
      try {
        const result = await promise;
        cache.set(cacheKey, result);
        // oxlint-disable-next-line no-unnecessary-condition
        if (!stale) entity.value = result;
      } finally {
        pending.delete(cacheKey);
      }
    },
    { immediate: true },
  );

  return { entity };
}
