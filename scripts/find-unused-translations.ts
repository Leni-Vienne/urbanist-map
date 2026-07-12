/**
 * Script to find and remove unused translation keys.
 *
 * Usage:
 *   bun run scripts/find-unused-translations.ts           # Report only
 *   bun run scripts/find-unused-translations.ts --remove  # Report and remove unused keys
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const LOCALES_DIR = join(import.meta.dir, "../front/src/locales/messages");
const SEARCH_DIRS = [join(import.meta.dir, "../front/src")];
const SEARCH_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx"]);

// Keys that are dynamically built and excluded from the unused check.
// Add prefixes for keys used via patterns like t(`status.${value}`)
const IGNORED_PREFIXES: string[] = [
  "status.", // Used dynamically via t(`status.${status}`)
  "fields.", // Used dynamically for field names
  "relativeTime.", // Used dynamically for time formatting
  "validation.", // Used dynamically for validation messages
  "auth.error.", // Used dynamically for auth error codes
  "moderation.rejectionReason.", // Used dynamically for rejection reasons
];

// Recursively extract all translation keys from a nested object
function extractKeys(obj: unknown, prefix = ""): string[] {
  const keys: string[] = [];

  if (typeof obj !== "object" || obj === null) {
    return keys;
  }

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...extractKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

// Recursively get all files with the specified extensions
function getFilesRecursively(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and locales directories
        if (entry !== "node_modules" && entry !== "locales") {
          files.push(...getFilesRecursively(fullPath));
        }
      } else if (SEARCH_EXTENSIONS.has(extname(entry))) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

// Detect dynamic key prefixes used in the codebase (e.g. t(`prefix.${val}`))
function findDynamicPrefixes(fileContents: Map<string, string>): Set<string> {
  const dynamicPrefixes = new Set<string>();

  // Regex to find patterns like t(`prefix.${...}`) or t('prefix.' + ...)
  const templateLiteralRegex = /\$?t\(`([a-zA-Z_][a-zA-Z0-9_.]*)\.\$\{/g;
  const concatRegex = /\$?t\(['"]([a-zA-Z_][a-zA-Z0-9_.]*)\.['"]\s*\+/g;

  for (const content of fileContents.values()) {
    let match;

    while ((match = templateLiteralRegex.exec(content)) !== null) {
      dynamicPrefixes.add(`${match[1]}.`);
    }

    while ((match = concatRegex.exec(content)) !== null) {
      dynamicPrefixes.add(`${match[1]}.`);
    }
  }

  return dynamicPrefixes;
}

// Extract keys referenced from real i18n call sites only: t('key'), $t('key')
// (single/double/backtick, static) and <i18n-t keypath="key">. High precision,
// used for missing-key detection (unlike isKeyUsed, no bare-string heuristics).
function extractReferencedKeys(fileContents: Map<string, string>): Set<string> {
  const referenced = new Set<string>();

  // (?<![\w$]) avoids matching the trailing t( of words like format(, insert()
  const tCallRegex = /(?<![\w$])\$?t\(\s*["'`]([^"'`$]+)["'`]/g;
  const keypathRegex = /keypath\s*=\s*["']([^"']+)["']/g;

  for (const content of fileContents.values()) {
    let match;

    while ((match = tCallRegex.exec(content)) !== null) {
      referenced.add(match[1]);
    }

    while ((match = keypathRegex.exec(content)) !== null) {
      referenced.add(match[1]);
    }
  }

  return referenced;
}

// Report referenced keys that are absent from the reference locale and not
// covered by a dynamic or ignored prefix (i.e. broken/typo t() call sites).
function reportMissingKeys(
  referencedKeys: Set<string>,
  referenceKeys: Set<string>,
  ignoredPrefixes: Set<string>,
): void {
  const missing = [...referencedKeys]
    .filter((key) => !referenceKeys.has(key))
    .filter((key) => ![...ignoredPrefixes].some((prefix) => key.startsWith(prefix)))
    .sort();

  console.log(
    `\n🔎 Checking ${referencedKeys.size} referenced keys against the reference locale...`,
  );

  if (missing.length === 0) {
    console.log("   ✅ No missing keys referenced in code!");
    return;
  }

  console.log(
    `   ⚠️  Found ${missing.length} keys referenced in code but missing from the reference locale:`,
  );
  for (const key of missing) {
    console.log(`      - ${key}`);
  }
}

// Report keys that exist in the reference locale but are absent from another locale.
function reportLocaleParity(
  referenceName: string,
  referenceKeys: Set<string>,
  otherName: string,
  otherKeys: Set<string>,
): void {
  const missingFromOther = [...referenceKeys].filter((key) => !otherKeys.has(key)).sort();
  const extraInOther = [...otherKeys].filter((key) => !referenceKeys.has(key)).sort();

  if (missingFromOther.length === 0 && extraInOther.length === 0) {
    console.log(`   ✅ ${otherName} matches ${referenceName}`);
    return;
  }

  if (missingFromOther.length > 0) {
    console.log(
      `   ⚠️  ${missingFromOther.length} keys in ${referenceName} but missing from ${otherName}:`,
    );
    for (const key of missingFromOther) {
      console.log(`      - ${key}`);
    }
  }

  if (extraInOther.length > 0) {
    console.log(`   ⚠️  ${extraInOther.length} keys in ${otherName} but not in ${referenceName}:`);
    for (const key of extraInOther) {
      console.log(`      - ${key}`);
    }
  }
}

// Check if a translation key is referenced in any source file
function isKeyUsed(key: string, files: string[], fileContents: Map<string, string>): boolean {
  // Matches common patterns: t('key'), $t('key'), t("key"), $t("key"), backtick variants,
  // the <i18n-t keypath="key"> component attribute, and bare string literals (for
  // variable-indirected usage)
  const patterns = [
    `t('${key}'`,
    `t("${key}"`,
    `$t('${key}'`,
    `$t("${key}"`,
    `t(\`${key}\``,
    `$t(\`${key}\``,
    `keypath="${key}"`,
    `keypath='${key}'`,
    `'${key}'`,
    `"${key}"`,
  ];

  for (const file of files) {
    const content = fileContents.get(file);
    if (!content) continue;

    for (const pattern of patterns) {
      if (content.includes(pattern)) {
        return true;
      }
    }
  }

  return false;
}

// Remove a nested key from an object by dot-separated path
function removeKey(obj: Record<string, unknown>, keyPath: string): boolean {
  const parts = keyPath.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!part) {
      return false;
    }

    if (typeof current[part] !== "object" || current[part] === null) {
      return false;
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];

  if (!lastPart) {
    return false;
  }

  if (lastPart in current) {
    delete current[lastPart];
    return true;
  }

  return false;
}

// Remove empty parent objects after key deletion
function cleanEmptyObjects(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      cleanEmptyObjects(value as Record<string, unknown>);
      if (Object.keys(value as Record<string, unknown>).length === 0) {
        delete obj[key];
      }
    }
  }
}

async function main() {
  const removeUnused = process.argv.includes("--remove");

  console.log("🔍 Finding unused translation keys...\n");

  // Get all source files
  const sourceFiles: string[] = [];
  for (const dir of SEARCH_DIRS) {
    sourceFiles.push(...getFilesRecursively(dir));
  }

  console.log(`📁 Found ${sourceFiles.length} source files to search\n`);

  // Pre-load all file contents for faster searching
  const fileContents = new Map<string, string>();
  for (const file of sourceFiles) {
    try {
      fileContents.set(file, readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  }

  // Find dynamic prefixes used in the codebase
  const dynamicPrefixes = findDynamicPrefixes(fileContents);
  if (dynamicPrefixes.size > 0) {
    console.log("🔄 Detected dynamic key prefixes (will be ignored):");
    for (const prefix of dynamicPrefixes) {
      console.log(`   - ${prefix}*`);
    }
    console.log();
  }

  // Combine detected dynamic prefixes with static ignored prefixes
  const allIgnoredPrefixes = new Set([...IGNORED_PREFIXES, ...dynamicPrefixes]);

  // Keys referenced from real i18n call sites, for missing-key detection
  const referencedKeys = extractReferencedKeys(fileContents);

  // Get all locale files
  const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

  const localeKeySets = new Map<string, Set<string>>();

  for (const localeFile of localeFiles) {
    const localePath = join(LOCALES_DIR, localeFile);
    console.log(`\n📄 Processing ${localeFile}...`);

    try {
      const content = readFileSync(localePath, "utf8");
      const translations = JSON.parse(content) as Record<string, unknown>;
      const allKeys = extractKeys(translations);
      localeKeySets.set(localeFile, new Set(allKeys));

      console.log(`   Total keys: ${allKeys.length}`);

      const unusedKeys: string[] = [];
      let ignoredCount = 0;

      for (const key of allKeys) {
        // Check if key matches any ignored prefix
        const isIgnored = [...allIgnoredPrefixes].some((prefix) => key.startsWith(prefix));

        if (isIgnored) {
          ignoredCount += 1;
          continue;
        }

        if (!isKeyUsed(key, sourceFiles, fileContents)) {
          unusedKeys.push(key);
        }
      }

      console.log(`   Ignored (dynamic): ${ignoredCount}`);

      if (unusedKeys.length === 0) {
        console.log("   ✅ No unused keys found!");
      } else {
        console.log(`   ⚠️  Found ${unusedKeys.length} unused keys:`);
        for (const key of unusedKeys) {
          console.log(`      - ${key}`);
        }

        if (removeUnused) {
          console.log(`\n   🗑️  Removing ${unusedKeys.length} unused keys...`);

          for (const key of unusedKeys) {
            removeKey(translations, key);
          }

          cleanEmptyObjects(translations);

          writeFileSync(localePath, `${JSON.stringify(translations, null, 2)}\n`);
          console.log(`   ✅ Updated ${localeFile}`);
        }
      }
    } catch (error) {
      console.error(`Error processing ${localeFile}:`, error);
    }
  }

  // Missing-key detection against the reference locale (en.json if present)
  const referenceLocale = localeKeySets.has("en.json") ? "en.json" : localeFiles[0];
  const referenceKeys = referenceLocale ? localeKeySets.get(referenceLocale) : undefined;

  if (referenceLocale && referenceKeys) {
    console.log(`\n📌 Reference locale: ${referenceLocale}`);
    reportMissingKeys(referencedKeys, referenceKeys, allIgnoredPrefixes);

    console.log("\n🌐 Locale parity:");
    for (const [localeFile, keys] of localeKeySets) {
      if (localeFile === referenceLocale) continue;
      reportLocaleParity(referenceLocale, referenceKeys, localeFile, keys);
    }
  }

  console.log("\n✨ Done!");

  if (!removeUnused) {
    console.log("\nRun with --remove flag to delete unused keys.");
  }
}

main().catch(console.error);
