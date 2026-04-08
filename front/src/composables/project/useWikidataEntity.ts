import { ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";

interface WikidataEntity {
  description: string | null;
  /** P154: logo image URL (Wikimedia Commons) */
  logoUrl: string | null;
  /** P18: main image URL (Wikimedia Commons) */
  imageUrl: string | null;
  /** P2048: building/structure height converted to metres */
  heightM: number | null;
}

// Module-level session cache keyed by "Q123:en" — persists across component mounts
const cache = new Map<string, WikidataEntity | null>();
// In-flight promise cache to avoid duplicate requests for the same id+lang
const pending = new Map<string, Promise<WikidataEntity | null>>();

function commonsUrl(filename: string): string {
  return (
    "https://commons.wikimedia.org/wiki/Special:FilePath/" +
    encodeURIComponent(filename.replace(/ /g, "_"))
  );
}

function getStringClaim(claims: Record<string, unknown[]>, property: string): string | null {
  const snak = (claims[property]?.[0] as Record<string, unknown> | undefined)?.mainsnak as
    | Record<string, unknown>
    | undefined;
  if (snak?.snaktype !== "value") return null;
  const dv = snak.datavalue as Record<string, unknown> | undefined;
  if (dv?.type !== "string") return null;
  return (dv.value as string) ?? null;
}

function getHeightMetres(claims: Record<string, unknown[]>): number | null {
  const snak = (claims["P2048"]?.[0] as Record<string, unknown> | undefined)?.mainsnak as
    | Record<string, unknown>
    | undefined;
  if (snak?.snaktype !== "value") return null;
  const dv = snak.datavalue as Record<string, unknown> | undefined;
  if (dv?.type !== "quantity") return null;
  const qty = dv.value as Record<string, unknown>;
  const amount = Number.parseFloat(qty.amount as string);
  if (Number.isNaN(amount)) return null;

  // Convert to metres based on unit (identified by trailing Wikidata entity ID)
  const unit = (qty.unit as string) ?? "";
  if (unit.endsWith("Q11573")) return amount; // metre
  if (unit.endsWith("Q174728")) return amount / 100; // centimetre
  if (unit.endsWith("Q3710")) return amount * 0.3048; // foot
  if (unit.endsWith("Q218593")) return amount * 0.0254; // inch
  if (unit === "1") return amount; // dimensionless — assume metres
  return null;
}

async function fetchEntity(id: string, lang: string): Promise<WikidataEntity | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${encodeURIComponent(id)}&props=descriptions|claims` +
    `&format=json&origin=*&languages=${lang}|en`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const entities = data.entities as Record<string, Record<string, unknown>> | undefined;
    const entity = entities?.[id];
    if (!entity || "missing" in entity) return null;

    const descriptions = (entity.descriptions ?? {}) as Record<
      string,
      { value: string } | undefined
    >;
    const description = (descriptions[lang]?.value ?? descriptions["en"]?.value ?? null) as
      | string
      | null;

    const claims = (entity.claims ?? {}) as Record<string, unknown[]>;
    const logoFilename = getStringClaim(claims, "P154");
    const imageFilename = getStringClaim(claims, "P18");

    return {
      description,
      logoUrl: logoFilename ? commonsUrl(logoFilename) : null,
      imageUrl: imageFilename ? commonsUrl(imageFilename) : null,
      heightM: getHeightMetres(claims),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch and cache Wikidata entity data (description, logo, image, building height).
 * Results are cached for the session so each Q-id is fetched at most once per locale.
 */
export function useWikidataEntity(wikidataId: Ref<string | null | undefined>) {
  const { locale } = useI18n();
  const entity = ref<WikidataEntity | null>(null);
  const loading = ref(false);

  watch(
    [wikidataId, locale],
    async ([id, lang]) => {
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
        entity.value = (await inflight) ?? null;
        return;
      }

      loading.value = true;
      const promise = fetchEntity(id, lang as string);
      pending.set(cacheKey, promise);
      try {
        const result = await promise;
        cache.set(cacheKey, result);
        entity.value = result;
      } finally {
        loading.value = false;
        pending.delete(cacheKey);
      }
    },
    { immediate: true },
  );

  return { entity, loading };
}
