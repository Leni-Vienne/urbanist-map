// Local preview for the /project/:slug Cloudflare Pages Function without building or deploying.
// Calls the Function's onRequest with a mocked Pages context (an ASSETS binding that serves the
// real index.html shell, plus BACKEND_API_URL) and prints the resulting HTML so you can inspect the
// injected <head> tags and noscript body.
//
// Usage:
//   bun run scripts/preview-seo.ts <slug> [backendUrl]
//   BACKEND_API_URL=http://localhost:3000 bun run scripts/preview-seo.ts my-project-slug
//
// Defaults: backend = https://api.urbanistmap.org (prod, read-only GET), shell = front/dist if built
// else front/index.html. Writes the full HTML to a temp file and opens it in the browser.

import { onRequest } from "../functions/project/[slug]";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(message: string): void {
  console.log(`[${ts()}] ${message}`);
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? "";
  if (!slug) {
    console.error("Usage: bun run scripts/preview-seo.ts <slug> [backendUrl]");
    process.exit(1);
  }

  const backend = process.argv[3] ?? process.env.BACKEND_API_URL ?? "https://api.urbanistmap.org";

  const builtShell = "front/dist/index.html";
  const sourceShell = "front/index.html";
  const shellPath = existsSync(builtShell) ? builtShell : sourceShell;
  log(`Using shell: ${shellPath} (built shell ${existsSync(builtShell) ? "found" : "absent"})`);

  const shellHtml = readFileSync(shellPath, "utf8");

  log(`Fetching SEO JSON from ${backend}/seo/project/${slug} ...`);
  const context = {
    request: new Request(`https://urbanistmap.org/project/${slug}`),
    params: { slug },
    env: {
      BACKEND_API_URL: backend,
      ASSETS: {
        fetch: async () => new Response(shellHtml, { headers: { "Content-Type": "text/html" } }),
      },
    },
  };

  const response = await onRequest(context);
  const html = await response.text();
  log(`Function returned HTTP ${response.status}`);

  // Echo just the injected <head> and the noscript so the result is readable in the terminal.
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
  const noscriptMatch = html.match(/<noscript>[\s\S]*?<\/noscript>/i);
  console.log("\n----- injected <head> -----");
  console.log(headMatch ? headMatch[1].trim() : "(no <head> found)");
  console.log("\n----- noscript body -----");
  console.log(noscriptMatch ? noscriptMatch[0] : "(no <noscript> found)");

  const outPath = join(process.cwd(), `preview-seo-${slug.replace(/[^a-z0-9-]/gi, "_")}.html`);
  writeFileSync(outPath, toViewableHtml(html), "utf8");
  log(`Viewable HTML written to ${outPath} (open in browser)`);
}

// The real shell boots the SPA from absolute /assets paths, which break under file:// and paint the
// empty #app div white over everything. For a standalone, double-clickable preview we drop that
// bootstrap and unwrap the <noscript> so the crawler-visible content (h1, description, status, tags,
// tagline) actually renders. This is a debug rendering only; inspect the terminal output or the
// wrangler dev server for the byte-exact shell.
function toViewableHtml(html: string): string {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*\/?>/gi, "")
      .replace(/<link\b[^>]*rel="(?:modulepreload|stylesheet)"[^>]*>/gi, "")
      .replace(
        /<noscript>/gi,
        '<div style="font-family:sans-serif;max-width:680px;margin:2rem auto">',
      )
      .replace(/<\/noscript>/gi, "</div>")
      // Collapse the blank-line residue left where the strip passes above removed tags.
      .replace(/(?:[ \t]*\r?\n){2,}/g, "\n")
  );
}

main().catch((error) => {
  console.error("Preview failed:", error);
  process.exit(1);
});
