// Cloudflare Pages Function for /project/:slug.
//
// Humans and bots receive the SAME built index.html shell (no cloaking). This Function fetches the
// per-project metadata as JSON from the backend, splices <title>/description/OpenGraph/Twitter/
// canonical/JSON-LD (and noindex when applicable) into the shell's <head>, then returns it. The SPA
// then boots from that shell and focuses the map on the project (see useProjectDeepLink). Bots and
// link-preview scrapers, which do not run JS, read the injected tags directly.
//
// Status codes pass through from the backend: 200 (live), 410 (deleted -> de-index), 404 (unknown).

interface SeoLocation {
  city: string | null;
  state: string | null;
  country: string | null;
  label: string | null;
}

interface SeoProject {
  status: "ok" | "gone" | "not_found" | "error";
  name?: string | null;
  description?: string | null;
  slug?: string;
  timelineStatus?: string | null;
  proposalDate?: string | null;
  proposalDatePrecision?: string | null;
  startDate?: string | null;
  startDatePrecision?: string | null;
  endDate?: string | null;
  endDatePrecision?: string | null;
  tags?: string[] | null;
  externalLastModified?: string | null;
  lat?: number | null;
  lng?: number | null;
  indexable?: boolean;
  location?: SeoLocation;
  image?: string | null;
  canonical?: string;
}

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
// Site-level brand line appended to the crawlable noscript body. The count is a rounded, manually
// maintained figure (kept in sync with the homepage shell's meta description, currently lower).
const SITE_TAGLINE = "Explore 500,000+ urban projects worldwide on Urbanistmap.org.";

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

// Human-readable timeline stage labels, mirroring the frontend timelineStatus messages.
const TIMELINE_STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  planned: "Planned",
  under_construction: "Under construction",
  completed: "Completed",
  canceled: "Canceled",
};

// Display labels for project tag slugs, mirroring the en `tags.*` locale keys (the slug `subway`
// reads "Metro", `light_rail` reads "Light Rail", etc.). Duplicated here because this Pages Function
// is bundled separately from the app and cannot import the frontend i18n. Unknown slugs fall back to
// the raw slug. Source of truth: front/src/locales/messages/en.json -> "tags".
const TAG_LABELS: Record<string, string> = {
  tram: "Tram",
  light_rail: "Light Rail",
  rail: "Railway",
  subway: "Metro",
  bus: "Bus",
  cable_car: "Cable Car",
  airport: "Airport",
  bike: "Bike",
  road: "Road",
  waterway: "Waterway",
  park: "Park / Green space",
  building: "Building",
  residential: "Residential",
  commercial: "Commercial",
  retail: "Retail",
  office: "Office",
  industrial: "Industrial",
  pedestrian: "Pedestrian",
};

// Format an ISO date string at the stored precision: year -> "2027", month -> "June 2027",
// day (or null) -> "June 23, 2027". Returns "" for an unparseable date.
function formatSeoDate(iso: string, precision: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (precision === "year") return String(date.getUTCFullYear());
  const options: Intl.DateTimeFormatOptions =
    precision === "month"
      ? { year: "numeric", month: "long", timeZone: "UTC" }
      : { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
  return date.toLocaleDateString("en-US", options);
}

// Resolve the date sentence shown for a project, mirroring the SPA's proposed/period/start/end
// priority (see utils/projectDateFormat.ts). Returns "" when no date is available.
function resolveSeoDateLabel(data: SeoProject): string {
  if (data.timelineStatus === "proposed" && data.proposalDate) {
    return `Proposed ${formatSeoDate(data.proposalDate, data.proposalDatePrecision)}`;
  }
  const start = data.startDate ? formatSeoDate(data.startDate, data.startDatePrecision) : "";
  const end = data.endDate ? formatSeoDate(data.endDate, data.endDatePrecision) : "";
  if (start && end) return `${start} - ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Estimated completion ${end}`;
  if (data.proposalDate) {
    return `Proposed ${formatSeoDate(data.proposalDate, data.proposalDatePrecision)}`;
  }
  return "";
}

// Serialize a value for embedding inside a <script> element. JSON.stringify produces valid JSON but
// leaves `<`, `>` and `&` literal, so a user-authored field containing "</script>" would break out of
// the ld+json block and inject live DOM. Escaping these to their \uXXXX forms keeps the JSON valid and
// closes that hole.
function serializeJsonLd(value: unknown): string {
  // Backslash from its char code, so the \uXXXX escapes are assembled rather than written literally.
  const bs = String.fromCharCode(92);
  return JSON.stringify(value)
    .replace(/</g, `${bs}u003c`)
    .replace(/>/g, `${bs}u003e`)
    .replace(/&/g, `${bs}u0026`);
}

// Build the schema.org Place JSON-LD string, including the timeline stage/dates as PropertyValue
// entries and the project tags as keywords.
function buildJsonLd(
  data: SeoProject,
  name: string,
  description: string,
  canonical: string,
  image: string,
  locationLabel: string | null,
  statusLabel: string | null,
  dateLabel: string,
  tags: string[],
): string {
  const additionalProperty = [
    statusLabel ? { "@type": "PropertyValue", name: "Timeline status", value: statusLabel } : null,
    dateLabel ? { "@type": "PropertyValue", name: "Timeline", value: dateLabel } : null,
  ].filter(Boolean);

  return serializeJsonLd({
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description,
    url: canonical,
    image,
    ...(data.lat != null && data.lng != null
      ? { geo: { "@type": "GeoCoordinates", latitude: data.lat, longitude: data.lng } }
      : {}),
    ...(locationLabel
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: data.location?.city ?? undefined,
            addressRegion: data.location?.state ?? undefined,
            addressCountry: data.location?.country ?? undefined,
          },
        }
      : {}),
    ...(tags.length > 0 ? { keywords: tags.join(", ") } : {}),
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
  });
}

// Render the timeline stage, dates and tags as a crawler-visible <ul> inside the noscript block.
function buildNoscriptDetails(
  statusLabel: string | null,
  dateLabel: string,
  tags: string[],
): string {
  const rows = [
    statusLabel ? `<li>Status: ${escapeHtml(statusLabel)}</li>` : "",
    dateLabel ? `<li>Timeline: ${escapeHtml(dateLabel)}</li>` : "",
    tags.length > 0 ? `<li>Tags: ${escapeHtml(tags.join(", "))}</li>` : "",
  ].filter(Boolean);
  return rows.length > 0 ? `<ul>${rows.join("")}</ul>` : "";
}

function indefiniteArticle(nextWord: string): "a" | "an" {
  return /^[aeiou]/i.test(nextWord) ? "an" : "a";
}

// Build a unique, natural one-sentence description for projects with no author-written description,
// weaving in the tag, lifecycle status and location so each page reads differently. Avoids the
// thousands of near-duplicate meta descriptions a single boilerplate string would produce.
function describeProject(subject: string, timelineStatus: string | null | undefined): string {
  // "under construction" reads better as a trailing clause ("a Metro project under construction");
  // the other statuses read naturally as a leading adjective ("a proposed Metro project").
  if (timelineStatus === "under_construction") {
    return `${indefiniteArticle(subject)} ${subject} under construction`;
  }
  const label = timelineStatus ? TIMELINE_STATUS_LABELS[timelineStatus] : undefined;
  if (label) {
    const adjective = label.toLowerCase();
    return `${indefiniteArticle(adjective)} ${adjective} ${subject}`;
  }
  return `${indefiniteArticle(subject)} ${subject}`;
}

// Build a unique, natural one-sentence description for projects with no author-written description,
// weaving in the tag, lifecycle status and location so each page reads differently. Avoids the
// thousands of near-duplicate meta descriptions a single boilerplate string would produce.
function buildFallbackDescription(
  name: string,
  locationLabel: string | null,
  tag: string | null,
  timelineStatus: string | null | undefined,
): string {
  const subject = tag ? `${tag} project` : "urban project";
  const where = locationLabel ? ` in ${locationLabel}` : "";
  return `${name} is ${describeProject(subject, timelineStatus)}${where}.`;
}

function buildLiveTags(data: SeoProject): { head: string; body: string } {
  const name = (data.name ?? "").trim() || "Urban project";
  const locationLabel = data.location?.label ?? null;
  const titleText = `${name} | Urbanistmap.org`;
  const canonical = data.canonical ?? `${SITE_URL}/project/${data.slug ?? ""}`;
  const image = data.image ?? DEFAULT_OG_IMAGE;
  const robots = data.indexable ? "index,follow" : "noindex";

  const statusLabel = data.timelineStatus
    ? (TIMELINE_STATUS_LABELS[data.timelineStatus] ?? null)
    : null;
  const dateLabel = resolveSeoDateLabel(data);
  const tags = (data.tags ?? [])
    .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    .map((tag) => TAG_LABELS[tag] ?? tag);

  const description = data.description
    ? truncate(data.description, 200)
    : buildFallbackDescription(name, locationLabel, tags[0] ?? null, data.timelineStatus);

  const jsonLd = buildJsonLd(
    data,
    name,
    description,
    canonical,
    image,
    locationLabel,
    statusLabel,
    dateLabel,
    tags,
  );

  const t = escapeHtml(titleText);
  const d = escapeHtml(description);
  const ogDescription = escapeHtml(`${description}\n\n${SITE_TAGLINE}`);
  const c = escapeHtml(canonical);
  const img = escapeHtml(image);

  // Hand the project location to the SPA so the map is constructed already centered on it (read in
  // services/core/map.ts), instead of animating in from the default world view after boot.
  const deeplinkView =
    data.lat != null && data.lng != null
      ? `<meta name="deeplink-view" content="${data.lat},${data.lng}" />`
      : "";

  const head = [
    deeplinkView,
    `<title>${t}</title>`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${c}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Urbanist Map" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${ogDescription}" />`,
    `<meta property="og:url" content="${c}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${ogDescription}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");

  // A <noscript> in <head> may only hold link/style/meta, so this flow content goes in the body.
  const body = `<noscript><h1>${t}</h1><p>${d}</p>${buildNoscriptDetails(statusLabel, dateLabel, tags)}<p>${escapeHtml(SITE_TAGLINE)}</p></noscript>`;

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
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

// Inject the per-project head tags and the crawler-visible <noscript> body block. The body block goes
// right after the opening <body> tag so its flow content is valid markup (a <noscript> in <head> may
// only contain link/style/meta).
function injectLiveContent(html: string, parts: { head: string; body: string }): string {
  const withHead = injectIntoHead(html, parts.head);
  return withHead.replace(/<body\b[^>]*>/i, (match) => `${match}\n    ${parts.body}`);
}

// Fetch the backend verdict, returning null on any transport problem (unreachable backend, non-JSON
// body such as a gateway error page or a plain-text 404 from a misrouted request). Returning null
// keeps these failures distinct from the backend's deliberate ok/gone/not_found JSON contract, so a
// transient hiccup never gets turned into a crawler-visible error status.
async function fetchSeoProject(backend: string, slug: string): Promise<SeoProject | null> {
  try {
    const response = await fetch(`${backend}/seo/project/${encodeURIComponent(slug)}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const data = (await response.json()) as SeoProject | null;
    return data && typeof data.status === "string" ? data : null;
  } catch {
    return null;
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, params, env } = context;
  const slugParam = params.slug;
  const slug = (Array.isArray(slugParam) ? slugParam[0] : slugParam) ?? "";

  // Fetch the built shell from the same deployment.
  const shellResponse = await env.ASSETS.fetch(new URL("/index.html", request.url));
  let html = await shellResponse.text();

  const backend = env.BACKEND_API_URL ?? DEFAULT_BACKEND;

  // Default to serving the un-injected shell with 200 so humans always get a working app. The HTTP
  // status is driven by the backend's verdict (gone, not_found), never by raw transport errors, so a
  // backend blip can't tell Google to de-index a healthy project.
  let status = 200;
  let cacheControl = "public, max-age=300";

  const data = await fetchSeoProject(backend, slug);

  if (data?.status === "ok") {
    html = injectLiveContent(html, buildLiveTags(data));
  } else if (data?.status === "gone") {
    html = injectIntoHead(
      html,
      buildGoneOrMissingTags(
        "Project unavailable | Urbanist Map",
        "This project has been completed or removed.",
      ),
    );
    status = 410;
    cacheControl = "no-cache";
  } else if (data?.status === "not_found") {
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
    // Backend unreachable, non-JSON, or an unrecognized verdict: serve the SPA shell so humans get
    // the app (bots see the shell's default tags) and keep 200 to avoid a spurious de-index signal.
    cacheControl = "no-cache";
  }

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}
