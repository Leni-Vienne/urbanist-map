/**
 * AI: Script to find unused members exported from Pinia setup stores.
 *
 * Pinia setup stores return an object whose properties are invisible to
 * static analysis tools like knip. This script replicates what knip would
 * do by:
 *   1. Parsing the `return { ... }` block of each store to get exported members
 *   2. Searching the entire frontend source for usages of each member name
 *   3. Reporting members with zero usages outside their own store file
 *
 * Usage:
 *   bun run scripts/find-unused-store-members.ts
 *
 * ⚠️  False positives: very short or generic names (e.g. `mode`, `overlays`)
 *     may shadow usages from unrelated code. Always verify before deleting.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE_DIR = join(ROOT, "front/src/stores");
const SEARCH_DIR = join(ROOT, "front/src");
const SEARCH_EXTENSIONS = new Set([".ts", ".vue"]);

// AI: Names shorter than this are flagged as low-confidence results
const MIN_CONFIDENT_LENGTH = 6;

// AI: Recursively collect all files with the given extensions
function getFilesRecursively(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath));
    } else if (SEARCH_EXTENSIONS.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

// AI: Extract the shorthand property names from the last `return { }` block in a store file.
// Only matches shorthand properties (bare identifiers), not `key: value` pairs.
function extractReturnKeys(content: string): string[] {
  const returnIdx = content.lastIndexOf("return {");
  if (returnIdx === -1) return [];

  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;

  for (let i = returnIdx + "return ".length; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }

  if (bodyStart === -1 || bodyEnd === -1) return [];

  const body = content.slice(bodyStart + 1, bodyEnd);
  const keys: string[] = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    // AI: Match `identifier` or `identifier,` optionally followed by an inline comment.
    // Rejects `key: value` patterns because they contain a colon after the identifier.
    const m = trimmed.match(/^([a-zA-Z_$][\w$]*),?\s*(?:\/\/.*)?$/);
    if (m) keys.push(m[1]!);
  }

  return keys;
}

// AI: Count how many files (excluding the store file itself) contain a word-boundary
// match for the given identifier.
function countUsages(
  identifier: string,
  fileContents: Map<string, string>,
  excludeFile: string,
): { count: number; files: string[] } {
  const regex = new RegExp(`\\b${identifier}\\b`);
  const matchingFiles: string[] = [];

  for (const [filePath, content] of fileContents) {
    if (filePath === excludeFile) continue;
    if (regex.test(content)) {
      matchingFiles.push(relative(ROOT, filePath));
    }
  }

  return { count: matchingFiles.length, files: matchingFiles };
}

// --- Main ---

const storeFiles = getFilesRecursively(STORE_DIR);
const allSourceFiles = getFilesRecursively(SEARCH_DIR);

// AI: Load all source files into memory once to avoid repeated disk reads
console.log(`Loading ${allSourceFiles.length} source files into memory...`);
const fileContents = new Map<string, string>();
for (const f of allSourceFiles) {
  fileContents.set(f, readFileSync(f, "utf8"));
}

console.log(`\nAnalyzing ${storeFiles.length} store files...\n`);
console.log("=".repeat(60));

let totalUnused = 0;
let totalLowConfidence = 0;

for (const storeFile of storeFiles) {
  const content = readFileSync(storeFile, "utf8");
  const members = extractReturnKeys(content);
  if (members.length === 0) continue;

  const useFnMatch = content.match(/export const (use\w+)/);
  const storeFnName = useFnMatch?.[1] ?? relative(STORE_DIR, storeFile);

  const unused: { key: string; lowConfidence: boolean }[] = [];

  for (const key of members) {
    const { count } = countUsages(key, fileContents, storeFile);
    if (count === 0) {
      const lowConfidence = key.length < MIN_CONFIDENT_LENGTH;
      unused.push({ key, lowConfidence });
      totalUnused++;
      if (lowConfidence) totalLowConfidence++;
    }
  }

  if (unused.length === 0) continue;

  console.log(`\n📦 ${storeFnName}  (${relative(ROOT, storeFile)})`);
  for (const { key, lowConfidence } of unused) {
    const suffix = lowConfidence ? "  ⚠️  short name — verify" : "";
    console.log(`   ❌  ${key}${suffix}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`\nTotal likely unused members : ${totalUnused}`);
if (totalLowConfidence > 0) {
  console.log(
    `Of which low-confidence     : ${totalLowConfidence}  (name < ${MIN_CONFIDENT_LENGTH} chars — may be false positives)`,
  );
}
console.log(
  "\n⚠️  A 0-usage result means the member name was not found anywhere\n" +
    "   in front/src outside its own store file. Always check with\n" +
    "   'Find All References' in your IDE before removing.",
);
