/**
 * AI: Script to find translation keys that have the same values (duplicates).
 *
 * Usage:
 *   bun run scripts/find-duplicate-translations.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(import.meta.dir, "../front/src/locales/messages");

// AI: Validates if a string is a simple value (not an object/array)
function isPrimitive(val: unknown): boolean {
  return typeof val === "string" || typeof val === "number" || typeof val === "boolean";
}

// AI: Recursively flatten the object to a Map of "key.path" -> "value"
function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
  result = new Map<string, string>(),
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value as Record<string, unknown>, fullKey, result);
    } else if (isPrimitive(value)) {
      result.set(fullKey, String(value));
    }
  }
  return result;
}

async function main() {
  console.log("🔍 Finding cross-language duplicates (English + French)...\n");

  try {
    // 1. Load both locales
    const enPath = join(LOCALES_DIR, "en.json");
    const frPath = join(LOCALES_DIR, "fr.json");

    const enContent = readFileSync(enPath, "utf8");
    const frContent = readFileSync(frPath, "utf8");

    const enMap = flattenObject(JSON.parse(enContent));
    const frMap = flattenObject(JSON.parse(frContent));

    // 2. Collect all keys
    const allKeys = new Set([...enMap.keys(), ...frMap.keys()]);

    // 3. Group by "Value Signature" (EnValue + FrValue)
    const signatureToKeys = new Map<string, string[]>();

    for (const key of allKeys) {
      const enVal = enMap.get(key);
      const frVal = frMap.get(key);

      // We only care if the key exists in at least one, but strictly speaking
      // for a "safe merge", it usually implies they exist in both or are consistently missing.
      // Let's treat missing as "undefined".
      if (enVal === undefined && frVal === undefined) continue;

      // Create a unique signature for the pair of values
      // Using a separator that is unlikely to be in the text
      const signature = JSON.stringify({ en: enVal, fr: frVal });

      if (!signatureToKeys.has(signature)) {
        signatureToKeys.set(signature, []);
      }
      signatureToKeys.get(signature)?.push(key);
    }

    // 4. Filter and Report
    const sortedGroups = Array.from(signatureToKeys.entries())
      .filter(([_, keys]) => keys.length > 1)
      .toSorted((a, b) => b[1].length - a[1].length); // Sort by group size

    if (sortedGroups.length === 0) {
      console.log("   ✅ No cross-language duplicates found!");
      return;
    }

    // Only show top 20 to avoid spamming
    const topGroups = sortedGroups.slice(0, 20);

    for (const [signatureJson, keys] of topGroups) {
      const { en, fr } = JSON.parse(signatureJson);

      const enDisplay = en ? `"${en.substring(0, 30)}${en.length > 30 ? "..." : ""}"` : "(missing)";
      const frDisplay = fr ? `"${fr.substring(0, 30)}${fr.length > 30 ? "..." : ""}"` : "(missing)";

      // Color coding: Green if identical in EN and FR (universal), Cyan otherwise
      const color = en === fr ? "\x1b[32m" : "\x1b[36m";
      const reset = "\x1b[0m";

      console.log(`${color}[${keys.length}] keys: ${enDisplay} / ${frDisplay}${reset}`);
      console.log(`   ${keys.join(", ")}`);
    }

    console.log(
      `\n⚠️  Found ${sortedGroups.length} groups of keys that have identical values in both English and French.`,
    );
    console.log("💡 These are safe candidates for deduplication (merging into a single key).");
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n✨ Done!");
}

main();
