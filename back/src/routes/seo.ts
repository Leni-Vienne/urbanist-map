import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../database";
import { projects, overlays, deletedProjects } from "../db/schema";
import { resolveBoundaryPath } from "../db/boundaryAssignment";
import { config } from "../config";

// Public, cookie-free endpoints consumed by the Cloudflare Pages Function (and any link-preview
// scraper). They return JSON the Function splices into the static index.html shell, plus the
// sitemap. Mounted before the session middleware so they never create a session.
export const seoApp = new Hono();

// OSM admin_level -> location component. 8 = city, 4 = state/province, 2 = country.
const CITY_LEVEL = 8;
const STATE_LEVEL = 4;
const COUNTRY_LEVEL = 2;

interface LocationLabel {
  city: string | null;
  state: string | null;
  country: string | null;
  label: string | null; // "City, State, Country" with missing levels dropped
}

// Walk the admin-boundary chain to a human location string. Prefers the English name. Falls back to
// the bare country code when the project has no assigned boundary (still common pending the boundary
// assign pass).
async function resolveLocationLabel(
  adminBoundaryId: string | null,
  countryCode: string | null,
): Promise<LocationLabel> {
  if (!adminBoundaryId) {
    return { city: null, state: null, country: countryCode, label: countryCode };
  }
  const path = await resolveBoundaryPath(adminBoundaryId);
  function pick(level: number): string | null {
    const entry = path.find((p) => p.adminLevel === level);
    return entry ? (entry.nameEn ?? entry.name) : null;
  }
  const city = pick(CITY_LEVEL);
  const state = pick(STATE_LEVEL);
  const country = pick(COUNTRY_LEVEL) ?? countryCode;
  const label = [city, state, country].filter(Boolean).join(", ") || countryCode;
  return { city, state, country, label };
}

// Absolute, auth-free image URL for og:image and JSON-LD. Mirrors the sidepanel priority:
// an approved overlay (render preferred over a map overlay), else the external OSM image tag.
// Wikidata P18 media is intentionally not resolved here (would need a Commons API round-trip); it
// remains a known small gap for v1.
async function resolvePrimaryImageUrl(
  projectId: string,
  externalProperties: unknown,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ filename: overlays.filename })
      .from(overlays)
      .where(and(eq(overlays.projectId, projectId), eq(overlays.status, "approved")))
      // Render (artist's impression) makes a better card than a top-down map overlay.
      .orderBy(
        sql`CASE WHEN ${overlays.kind} = 'render' THEN 0 ELSE 1 END`,
        desc(overlays.updatedAt),
      )
      .limit(1);

    // Only emit an overlay image when a public CDN base is configured: og:image must be an
    // absolute, auth-free URL that scrapers can fetch. The backend /uploads path needs credentials,
    // so it is never emitted here (it would break link previews). Falls through to the external tag.
    const filename = rows[0]?.filename;
    if (filename && config.R2_PUBLIC_URL) {
      return `${config.R2_PUBLIC_URL}/${filename}`;
    }
  } catch (error) {
    console.error("Failed to resolve primary image for SEO:", error);
  }

  // External OSM image tag, already sanitized to http/https at import time.
  if (externalProperties && typeof externalProperties === "object") {
    // oxlint-disable-next-line no-unsafe-type-assertion
    const image = (externalProperties as Record<string, unknown>).image;
    if (typeof image === "string" && /^https?:\/\//.test(image)) return image;
  }
  return null;
}

// GET /seo/project/:slug -> JSON the Pages Function turns into <head> tags.
// 200 for a live project, 410 + tombstone coords for a deleted one, 404 otherwise.
seoApp.get("/seo/project/:slug", async (c) => {
  const slug = c.req.param("slug");

  try {
    const rows = await db
      .select({
        name: projects.name,
        description: projects.description,
        slug: projects.slug,
        timelineStatus: projects.timelineStatus,
        proposalDate: projects.proposalDate,
        proposalDatePrecision: projects.proposalDatePrecision,
        startDate: projects.startDate,
        startDatePrecision: projects.startDatePrecision,
        endDate: projects.endDate,
        endDatePrecision: projects.endDatePrecision,
        tags: projects.tags,
        externalLastModified: projects.externalLastModified,
        lat: projects.lat,
        lng: projects.lng,
        indexable: projects.indexable,
        adminBoundaryId: projects.adminBoundaryId,
        countryCode: projects.countryCode,
        externalProperties: projects.externalProperties,
        id: projects.id,
        geometryBboxMinLat: sql<
          number | null
        >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_YMin(ST_Envelope(${projects.geometry})) ELSE NULL END`,
        geometryBboxMaxLat: sql<
          number | null
        >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_YMax(ST_Envelope(${projects.geometry})) ELSE NULL END`,
        geometryBboxMinLng: sql<
          number | null
        >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_XMin(ST_Envelope(${projects.geometry})) ELSE NULL END`,
        geometryBboxMaxLng: sql<
          number | null
        >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_XMax(ST_Envelope(${projects.geometry})) ELSE NULL END`,
      })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);

    const project = rows[0];
    if (project) {
      const [location, image] = await Promise.all([
        resolveLocationLabel(project.adminBoundaryId, project.countryCode),
        resolvePrimaryImageUrl(project.id, project.externalProperties),
      ]);

      return c.json({
        status: "ok" as const,
        name: project.name,
        description: project.description,
        slug: project.slug,
        timelineStatus: project.timelineStatus,
        proposalDate: project.proposalDate,
        proposalDatePrecision: project.proposalDatePrecision,
        startDate: project.startDate,
        startDatePrecision: project.startDatePrecision,
        endDate: project.endDate,
        endDatePrecision: project.endDatePrecision,
        tags: project.tags,
        externalLastModified: project.externalLastModified,
        lat: project.lat,
        lng: project.lng,
        bounds:
          project.geometryBboxMinLat !== null &&
          project.geometryBboxMaxLat !== null &&
          project.geometryBboxMinLng !== null &&
          project.geometryBboxMaxLng !== null
            ? [
                project.geometryBboxMinLng,
                project.geometryBboxMinLat,
                project.geometryBboxMaxLng,
                project.geometryBboxMaxLat,
              ]
            : null,
        // The page is only indexable when approved AND it carries showable content (see indexable.ts).
        indexable: project.indexable,
        location,
        image,
        canonical: `${config.PUBLIC_SITE_URL}/project/${project.slug}`,
      });
    }

    // No live project: check for a tombstone so an indexed URL de-indexes cleanly (410).
    const tombstones = await db
      .select({
        lat: deletedProjects.lat,
        lng: deletedProjects.lng,
        status: deletedProjects.status,
      })
      .from(deletedProjects)
      .where(eq(deletedProjects.slug, slug))
      .limit(1);

    const tombstone = tombstones[0];
    if (tombstone) {
      return c.json(
        {
          status: "gone" as const,
          slug,
          lat: tombstone.lat,
          lng: tombstone.lng,
          projectStatus: tombstone.status,
        },
        410,
      );
    }

    return c.json({ status: "not_found" as const, slug }, 404);
  } catch (error) {
    console.error("Error resolving SEO project:", error);
    return c.json({ status: "error" as const }, 500);
  }
});

// GET /seo/sitemap.xml -> all indexable project URLs. ~4.5k fits one file (50k-URL limit).
seoApp.get("/seo/sitemap.xml", async (c) => {
  try {
    const rows = await db
      .select({ slug: projects.slug, updatedAt: projects.updatedAt })
      .from(projects)
      .where(and(eq(projects.indexable, true), sql`${projects.slug} IS NOT NULL`));

    const base = config.PUBLIC_SITE_URL;
    const urls = rows
      .map((r) => {
        const loc = `${base}/project/${encodeURIComponent(String(r.slug))}`;
        const lastmod = new Date(r.updatedAt).toISOString();
        return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(xml);
  } catch (error) {
    console.error("Error building sitemap:", error);
    return c.text("Internal Server Error", 500);
  }
});
