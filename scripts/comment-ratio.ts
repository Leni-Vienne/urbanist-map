/**
 * Script to find files with the highest comment-to-total-lines ratio.
 *
 * Supports: .ts, .vue, .js (single-line // and multi-line /* ... *\/)
 *
 * Usage:
 *   bun run scripts/comment-ratio.ts [--top N] [--min-lines N] [--dir path]
 *
 * Options:
 *   --top N         Number of files to display (default: 20)
 *   --min-lines N   Minimum total lines to include a file (default: 5)
 *   --dir path      Root directory to scan (default: project root)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..");

// --- CLI args parsing ---
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? (args[idx + 1] as string) : fallback;
}
const TOP_N = parseInt(getArg("--top", "20"), 10);
const MIN_LINES = parseInt(getArg("--min-lines", "5"), 10);
const SCAN_DIR = getArg("--dir", ROOT_DIR);

const SUPPORTED_EXTENSIONS = new Set([".ts", ".js", ".vue"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".nuxt", "coverage"]);

// --- File collection ---
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) results.push(...collectFiles(full));
    } else if (SUPPORTED_EXTENSIONS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

// --- Comment line counting ---
// A line is counted as a comment line if its trimmed content starts with //,
// or if it falls inside a /* ... */ block (including the opening/closing lines).
function countCommentLines(source: string): { total: number; comments: number } {
  const lines = source.split("\n");
  let comments = 0;
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue; // skip blank lines for both counts

    if (inBlock) {
      comments++;
      if (line.includes("*/")) inBlock = false;
    } else if (line.startsWith("//")) {
      comments++;
    } else if (line.startsWith("/*") || line.startsWith("/**")) {
      comments++;
      // Check if block closes on the same line
      const afterOpen = line.slice(2);
      if (!afterOpen.includes("*/")) inBlock = true;
    } else if (line.startsWith("*") && !line.startsWith("*/")) {
      // Inside a JSDoc block that started on a previous line — already counted
      // But we only get here if inBlock is false, meaning we may have missed the open.
      // This handles cases where inBlock was set to false by a close on same line above.
      // No action needed.
    }
  }

  // Total = non-blank lines
  const total = lines.filter((l) => l.trim() !== "").length;
  return { total, comments };
}

// --- Main ---
interface FileResult {
  path: string;
  total: number;
  comments: number;
  ratio: number;
}

function main() {
  const files = collectFiles(SCAN_DIR);
  const results: FileResult[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const { total, comments } = countCommentLines(source);
    if (total < MIN_LINES) continue;

    const ratio = comments / total;
    results.push({ path: relative(ROOT_DIR, file), total, comments, ratio });
  }

  results.sort((a, b) => b.ratio - a.ratio);
  const top = results.slice(0, TOP_N);

  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(
    `\n${bold}Comment ratio report${reset} ${dim}(top ${TOP_N}, min ${MIN_LINES} non-blank lines)${reset}\n`,
  );
  console.log(`${"Ratio".padEnd(8)}${"Comments".padEnd(12)}${"Total".padEnd(10)}File`);
  console.log("─".repeat(70));

  for (const r of top) {
    const pct = (r.ratio * 100).toFixed(1).padStart(5) + "%";
    const color = r.ratio >= 0.4 ? green : r.ratio >= 0.2 ? yellow : cyan;
    const comments = String(r.comments).padEnd(12);
    const total = String(r.total).padEnd(10);
    console.log(`${color}${pct}${reset}   ${comments}${total}${dim}${r.path}${reset}`);
  }

  const avgRatio = results.reduce((s, r) => s + r.ratio, 0) / results.length;
  console.log("\n" + "─".repeat(70));
  console.log(
    `${dim}Scanned ${results.length} files — average ratio: ${(avgRatio * 100).toFixed(1)}%${reset}\n`,
  );
}

main();
