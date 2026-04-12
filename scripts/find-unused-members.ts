/**
 * Script to find unused members exported from Pinia setup stores and composables.
 *
 * Parses the `return { ... }` block of each file to extract exported member names,
 * then searches the entire frontend source for usages outside the source file.
 *
 * Usage:
 *   bun run scripts/find-unused-members.ts
 *
 * Note: short or generic names (e.g. `mode`, `overlays`) may produce false positives.
 * Composables with nested `return { }` blocks will only have the last one analysed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE_DIR = join(ROOT, "front/src/stores");
const COMPOSABLES_DIR = join(ROOT, "front/src/composables");
const SEARCH_DIR = join(ROOT, "front/src");
const SEARCH_EXTENSIONS = new Set([".ts", ".vue"]);

// Names shorter than this are flagged as low-confidence results
const MIN_CONFIDENT_LENGTH = 6;

// Recursively collect all files with the given extensions
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

// Extract shorthand property names from the last `return { }` block in the file.
// Only matches bare identifiers, not `key: value` pairs.
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
    // Match `identifier` or `identifier,` optionally followed by an inline comment.
    // Rejects `key: value` patterns because they contain a colon after the identifier.
    const m = trimmed.match(/^([a-zA-Z_$][\w$]*),?\s*(?:\/\/.*)?$/);
    if (m) keys.push(m[1]!);
  }

  return keys;
}

// Count files (excluding the source file) that contain a word-boundary match for the identifier.
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

type AnalysisKind = "store" | "composable";
type AnalysisFile = { file: string; kind: AnalysisKind; dir: string };

const analysisFiles: AnalysisFile[] = [
  ...getFilesRecursively(STORE_DIR).map((f) => ({
    file: f,
    kind: "store" as const,
    dir: STORE_DIR,
  })),
  ...getFilesRecursively(COMPOSABLES_DIR).map((f) => ({
    file: f,
    kind: "composable" as const,
    dir: COMPOSABLES_DIR,
  })),
];
const allSourceFiles = getFilesRecursively(SEARCH_DIR);

// Load all source files into memory once
console.log(`Loading ${allSourceFiles.length} source files into memory...`);
const fileContents = new Map<string, string>();
for (const f of allSourceFiles) {
  fileContents.set(f, readFileSync(f, "utf8"));
}

console.log(`\nAnalyzing ${analysisFiles.length} files (stores + composables)...\n`);
console.log("=".repeat(60));

let totalUnused = 0;
let totalLowConfidence = 0;

for (const { file, kind, dir } of analysisFiles) {
  const content = readFileSync(file, "utf8");
  const members = extractReturnKeys(content);
  if (members.length === 0) continue;

  // Stores use `export const use...`, composables use `export function use...`
  const useFnMatch = content.match(/export (?:const|function) (use\w+)/);
  const fnName = useFnMatch?.[1] ?? relative(dir, file);
  const icon = kind === "store" ? "📦" : "🔧";

  const unused: { key: string; lowConfidence: boolean }[] = [];

  for (const key of members) {
    const { count } = countUsages(key, fileContents, file);
    if (count === 0) {
      const lowConfidence = key.length < MIN_CONFIDENT_LENGTH;
      unused.push({ key, lowConfidence });
      totalUnused++;
      if (lowConfidence) totalLowConfidence++;
    }
  }

  if (unused.length === 0) continue;

  console.log(`\n${icon} ${fnName}  [${kind}]  (${relative(ROOT, file)})`);
  for (const { key, lowConfidence } of unused) {
    console.log(`   ❌  ${key}${lowConfidence ? "  (short name, verify)" : ""}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`\nTotal likely unused members : ${totalUnused}`);
if (totalLowConfidence > 0) {
  console.log(
    `Of which low-confidence     : ${totalLowConfidence}  (name < ${MIN_CONFIDENT_LENGTH} chars, may be false positives)`,
  );
}
console.log(
  "\nA 0-usage result means the member was not found anywhere in front/src outside its own file.\n" +
    "Always verify with 'Find All References' in your IDE before removing.",
);
