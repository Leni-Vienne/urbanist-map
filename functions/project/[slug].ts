import type { SeoLocation, SeoProject, SeoProjectResponse } from "../../shared/types/seo";
import { formatProjectDateRangeParts } from "../../shared/projectDates";
import {
  fields as englishFields,
  project as englishProject,
  tags as englishTagLabels,
  timelineStatus as englishTimelineLabels,
} from "../../front/src/locales/messages/en.json";

interface PagesContext {
  request: Request;
  params: { slug?: string | string[] };
  env: {
    ASSETS: { fetch: (input: Request | string | URL) => Promise<Response> };
    BACKEND_API_URL?: string;
  };
}

const DEFAULT_BACKEND = "https://api.urbanistmap.org";
const SITE_URL = "https://urbanistmap.org";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-preview.jpg`;
const SITE_TAGLINE = "Explore 500,000+ urban projects worldwide.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function publicHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const url = URL.parse(value);
  if (url?.protocol === "https:" || url?.protocol === "http:") return url.href;
  return undefined;
}

// Strip the default SEO tags shipped in index.html so the per-project ones replace (not duplicate)
// them. Matches the identifying attribute anywhere in the tag (attribute order independent) and both
// self-closed (`/>`) and bare (`>`) forms, so a change in how the shell is serialized can't silently
// leave duplicate tags behind.
function stripDefaultSeoTags(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>/gi, "")
    .replace(/<meta\b[^>]*\bproperty=["']og:[^"']*["'][^>]*>/gi, "")
    .replace(/<meta\b[^>]*\bname=["']twitter:[^"']*["'][^>]*>/gi, "");
}

// Plain message data is shared even though the Pages Function is bundled separately from Vue.
const TIMELINE_STATUS_LABELS = new Map<string, string>(Object.entries(englishTimelineLabels));
const TAG_LABELS = new Map<string, string>(Object.entries(englishTagLabels));

function resolveSeoDateLabel(data: Partial<SeoProject>): string {
  const labels = new Map<string, string>(
    Object.entries({
      "project.proposalDate": "Proposed",
      "project.period": "",
      "project.startDate": "Starts",
      "project.estimatedCompletion": "Estimated completion",
    }),
  );
  const result = formatProjectDateRangeParts(data, (key) => labels.get(key) ?? "", "en-US");
  return result ? [result.label, result.value].filter(Boolean).join(" ") : "";
}

// Build the schema.org Place JSON-LD string, including the timeline stage/dates as PropertyValue
// entries and the project tags as keywords.
function buildJsonLd(
  data: Partial<SeoProject>,
  name: string,
  description: string,
  canonical: string,
  image: string | undefined,
  locationLabel: string | null,
  statusLabel: string | null,
  dateLabel: string,
  tags: string[],
): string {
  const additionalProperty = [
    statusLabel ? { "@type": "PropertyValue", name: "Timeline status", value: statusLabel } : null,
    dateLabel ? { "@type": "PropertyValue", name: "Timeline", value: dateLabel } : null,
  ].filter(Boolean);

  const hasCoordinates =
    data.lat !== null && data.lat !== undefined && data.lng !== null && data.lng !== undefined;

  // Escape markup delimiters within the script element.
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description,
    url: canonical,
    image,
    geo: hasCoordinates
      ? { "@type": "GeoCoordinates", latitude: data.lat, longitude: data.lng }
      : undefined,
    address: locationLabel
      ? {
          "@type": "PostalAddress",
          addressLocality: data.location?.city ?? undefined,
          addressRegion: data.location?.state ?? undefined,
          addressCountry: data.location?.country ?? undefined,
        }
      : undefined,
    keywords: tags.length > 0 ? tags.join(", ") : undefined,
    additionalProperty: additionalProperty.length > 0 ? additionalProperty : undefined,
  })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function buildProjectFacts(
  locationLabel: string | null,
  statusLabel: string | null,
  dateLabel: string,
  tags: string[],
): string {
  const rows = [
    locationLabel ? `<li>${englishProject.location}: ${escapeHtml(locationLabel)}</li>` : "",
    statusLabel ? `<li>${englishFields.timelineStatus}: ${escapeHtml(statusLabel)}</li>` : "",
    dateLabel ? `<li>${englishProject.period}: ${escapeHtml(dateLabel)}</li>` : "",
    tags.length > 0 ? `<li>${englishFields.tags}: ${escapeHtml(tags.join(", "))}</li>` : "",
  ].filter(Boolean);
  return rows.length > 0 ? `<ul>${rows.join("")}</ul>` : "";
}

function indefiniteArticle(nextWord: string): "a" | "an" {
  return /^[aeiou]/i.test(nextWord) ? "an" : "a";
}

// Describe the category and stage without an article so unnamed projects can start with this phrase.
function describeProject(subject: string, timelineStatus: string | null | undefined): string {
  // "under construction" reads better as a trailing clause; other stages lead the category.
  if (timelineStatus === "under_construction") {
    return `${subject} under construction`;
  }
  const label = timelineStatus ? TIMELINE_STATUS_LABELS.get(timelineStatus) : undefined;
  if (label) {
    const adjective = label.toLowerCase();
    return `${adjective} ${subject}`;
  }
  return subject;
}

// Build a unique, natural one-sentence description for projects with no author-written description,
// weaving in the tag, lifecycle status and location so each page reads differently. Avoids the
// thousands of near-duplicate meta descriptions a single boilerplate string would produce.
function buildFallbackDescription(
  name: string | null,
  locationLabel: string | null,
  tag: string | null,
  timelineStatus: string | null | undefined,
): string {
  const subject = tag ? `${tag.toLowerCase()} project` : "urban project";
  const phrase = describeProject(subject, timelineStatus);
  const where = locationLabel ? ` in ${locationLabel}` : "";
  if (name) return `${name} is ${indefiniteArticle(phrase)} ${phrase}${where}.`;
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}${where}.`;
}

/** The two injection points a project page needs: <head> tags and the crawler-visible body block. */
interface SeoTags {
  head: string;
  body: string;
}

function resolveSeoProjectName(
  name: string | null,
  category: string | null,
  location: SeoLocation | undefined,
): string {
  if (name) return name;
  const titleLocation = location?.city ?? location?.state ?? location?.country ?? location?.label;
  const fallbackName = category ? `${category} project` : "Urban project";
  return `${fallbackName}${titleLocation ? ` in ${titleLocation}` : ""}`;
}

function buildMapViewTag(data: Partial<SeoProject>): string {
  if (data.bounds) return `<meta name="deeplink-bounds" content="${data.bounds.join(",")}" />`;
  if (typeof data.lat === "number" && typeof data.lng === "number") {
    return `<meta name="deeplink-view" content="${data.lat},${data.lng}" />`;
  }
  return "";
}

// Keep rendering fallbacks for incomplete metadata from older backend deployments.
function buildLiveTags(data: Partial<SeoProject>): SeoTags {
  const projectName = (data.name ?? "").trim() || null;
  const locationLabel = data.location?.label ?? null;
  const canonical = data.canonical ?? `${SITE_URL}/project/${encodeURIComponent(data.slug ?? "")}`;
  const projectImage = publicHttpUrl(data.image);
  const image = projectImage ?? DEFAULT_OG_IMAGE;
  const robots = data.indexable ? "index,follow" : "noindex";

  const statusLabel = data.timelineStatus
    ? (TIMELINE_STATUS_LABELS.get(data.timelineStatus) ?? null)
    : null;
  const dateLabel = resolveSeoDateLabel(data);
  const tags = (data.tags ?? [])
    .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    .map((tag) => TAG_LABELS.get(tag) ?? tag);

  const category = tags[0] ?? null;
  const name = resolveSeoProjectName(projectName, category, data.location);
  const titleText = `${name} | Urbanist Map`;

  const description =
    data.description?.trim() ||
    buildFallbackDescription(projectName, locationLabel, category, data.timelineStatus);
  const snippet = truncate(description, 200);

  const jsonLd = buildJsonLd(
    data,
    name,
    description,
    canonical,
    projectImage,
    locationLabel,
    statusLabel,
    dateLabel,
    tags,
  );

  const t = escapeHtml(titleText);
  const ogDescription = escapeHtml(`${snippet}\n\n${SITE_TAGLINE}`);
  const c = escapeHtml(canonical);
  const img = escapeHtml(image);

  const head = [
    buildMapViewTag(data),
    `<title>${t}</title>`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="description" content="${escapeHtml(snippet)}" />`,
    `<link rel="canonical" href="${c}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Urbanist Map" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${ogDescription}" />`,
    `<meta property="og:url" content="${c}" />`,
    `<meta property="og:image" content="${img}" />`,
    projectImage ? "" : `<meta property="og:image:width" content="1200" />`,
    projectImage ? "" : `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${ogDescription}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");

  const source = publicHttpUrl(data.sourceUrl);
  const body = [
    `<article id="project-summary" lang="en">`,
    `<h1>${escapeHtml(name)}</h1>`,
    `<p>${escapeHtml(description)}</p>`,
    buildProjectFacts(locationLabel, statusLabel, dateLabel, tags),
    source ? `<p><a href="${escapeHtml(source)}">${englishProject.sourceUrl}</a></p>` : "",
    `<p><a href="/">Urbanist Map</a></p>`,
    `</article>`,
  ].join("\n");

  return { head, body };
}

function buildGoneOrMissingTags(title: string, description: string): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return [
    `<title>${t}</title>`,
    `<meta name="robots" content="noindex" />`,
    `<meta name="description" content="${d}" />`,
  ].join("\n    ");
}

function injectIntoHead(html: string, tags: string): string {
  const stripped = stripDefaultSeoTags(html);
  return stripped.replace(/<\/head>/i, () => `    ${tags}\n  </head>`);
}

function injectLiveContent(html: string, parts: SeoTags): string {
  const withHead = injectIntoHead(html, parts.head);
  return withHead.replace(/<body\b[^>]*>/i, (match) => `${match}\n    ${parts.body}`);
}

async function fetchSeoProject(backend: string, slug: string): Promise<SeoProjectResponse | null> {
  try {
    const response = await fetch(`${backend}/seo/project/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    // oxlint-disable-next-line no-unsafe-type-assertion
    const data = (await response.json()) as SeoProjectResponse | null;
    if (response.status === 200 && data?.status === "ok") return data;
    if (response.status === 410 && data?.status === "gone") return data;
    if (response.status === 404 && data?.status === "not_found") return data;
    return null;
  } catch {
    return null;
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, params, env } = context;
  const slugParam = params.slug;
  const slug = (Array.isArray(slugParam) ? slugParam[0] : slugParam) ?? "";

  const backend = env.BACKEND_API_URL ?? DEFAULT_BACKEND;
  const [shellResponse, data] = await Promise.all([
    env.ASSETS.fetch(new URL("/index.html", request.url)),
    fetchSeoProject(backend, slug),
  ]);
  if (!shellResponse.ok) return temporaryFailure(null);
  let html = await shellResponse.text();

  if (!data) return temporaryFailure(html);
  let status = 200;
  let cacheControl = "public, max-age=300";

  if (data.status === "ok") {
    html = injectLiveContent(html, buildLiveTags(data));
  } else if (data.status === "gone") {
    html = injectIntoHead(
      html,
      buildGoneOrMissingTags(
        "Project unavailable | Urbanist Map",
        "This project has been completed or removed.",
      ),
    );
    status = 410;
    cacheControl = "no-cache";
  } else if (data.status === "not_found") {
    html = injectIntoHead(
      html,
      buildGoneOrMissingTags(
        "Project not found | Urbanist Map",
        "This project could not be found.",
      ),
    );
    status = 404;
    cacheControl = "no-cache";
  } else {
    return temporaryFailure(html);
  }

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function temporaryFailure(html: string | null): Response {
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "60",
    },
  });
}
