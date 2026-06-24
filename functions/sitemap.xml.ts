// Cloudflare Pages Function for /sitemap.xml. A plain proxy to the backend sitemap endpoint so the
// sitemap is served from the apex host (Google prefers same-host sitemaps). The backend owns the
// list of indexable project URLs.

interface PagesContext {
  request: Request;
  env: { BACKEND_API_URL?: string };
}

const DEFAULT_BACKEND = "https://api.urbanistmap.org";

export async function onRequest(context: PagesContext): Promise<Response> {
  const backend = context.env.BACKEND_API_URL ?? DEFAULT_BACKEND;

  try {
    const response = await fetch(`${backend}/seo/sitemap.xml`);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 502 });
  }
}
