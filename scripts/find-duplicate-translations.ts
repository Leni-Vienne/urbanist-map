/**
 * Script to find translation keys that have the same values (duplicates).
 *
 * Usage:
 *   bun run scripts/find-duplicate-translations.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(import.meta.dir, "../front/src/locales/messages");

// Validates if a value is a primitive (not object or array)
function isPrimitive(val: unknown): boolean {
  return typeof val === "string" || typeof val === "number" || typeof val === "boolean";
}

// Recursively flatten a nested object to a "key.path" -> "value" map
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
    // Load both locales
    const enPath = join(LOCALES_DIR, "en.json");
    const frPath = join(LOCALES_DIR, "fr.json");

    const enContent = readFileSync(enPath, "utf8");
    const frContent = readFileSync(frPath, "utf8");

    const enMap = flattenObject(JSON.parse(enContent));
    const frMap = flattenObject(JSON.parse(frContent));

    // Collect all keys
    const allKeys = new Set([...enMap.keys(), ...frMap.keys()]);

    // Group by value pair (en + fr)
    const signatureToKeys = new Map<string, string[]>();

    for (const key of allKeys) {
      const enVal = enMap.get(key);
      const frVal = frMap.get(key);

      if (enVal === undefined && frVal === undefined) continue;

      const signature = JSON.stringify({ en: enVal, fr: frVal });

      if (!signatureToKeys.has(signature)) {
        signatureToKeys.set(signature, []);
      }
      signatureToKeys.get(signature)?.push(key);
    }

    // Filter groups with more than one key and sort by group size
    const sortedGroups = [...signatureToKeys.entries()]
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

      // Color by identity: green if EN and FR values match, cyan otherwise
      const color = en === fr ? "\x1b[32m" : "\x1b[36m";
      const reset = "\x1b[0m";

      console.log(`${color}[${keys.length}] keys: ${enDisplay} / ${frDisplay}${reset}`);
      console.log(`   ${keys.join(", ")}`);
    }

    console.log(
      `\n Found ${sortedGroups.length} groups of keys with identical values in both locales.`,
    );
    console.log("These are candidates for deduplication (merging into a single key).");
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n✨ Done!");
}

main();
