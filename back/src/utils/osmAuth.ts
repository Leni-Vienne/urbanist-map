// OpenStreetMap sign-in via OpenID Connect (the "openid" scope, "Se connecter avec
// OpenStreetMap" on the app registration). OSM exposes no email under this scope, so
// callers synthesize one from the numeric id. userinfo returns: sub, preferred_username.
const OSM_BASE = "https://www.openstreetmap.org";

// Must exactly match the redirect URI registered on the OSM OAuth application.
function getOsmRedirectUri(): string {
  return `${process.env.VITE_API_BASE_URL}/api/osm-callback`;
}

export function isOsmConfigured(): boolean {
  return Boolean(process.env.OSM_CLIENT_ID && process.env.OSM_CLIENT_SECRET);
}

export function buildOsmAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OSM_CLIENT_ID ?? "",
    redirect_uri: getOsmRedirectUri(),
    scope: "openid", // sign-in only; yields sub + preferred_username from userinfo
    state,
  });
  return `${OSM_BASE}/oauth2/authorize?${params.toString()}`;
}

// Exchange the authorization code for an access token, then read the OIDC userinfo.
// Returns null on any failure (logged).
export async function exchangeOsmCodeForUser(
  code: string,
): Promise<{ osmId: string; displayName: string } | null> {
  try {
    const tokenRes = await fetch(`${OSM_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: getOsmRedirectUri(),
        client_id: process.env.OSM_CLIENT_ID ?? "",
        client_secret: process.env.OSM_CLIENT_SECRET ?? "",
      }),
    });

    if (!tokenRes.ok) {
      console.error("OSM token exchange failed:", tokenRes.status, await tokenRes.text());
      return null;
    }

    // oxlint-disable-next-line no-unsafe-type-assertion
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return null;
    }

    const userRes = await fetch(`${OSM_BASE}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      console.error("OSM userinfo fetch failed:", userRes.status);
      return null;
    }

    // oxlint-disable-next-line no-unsafe-type-assertion
    const userData = (await userRes.json()) as { sub?: string; preferred_username?: string };
    if (!userData.sub) {
      return null;
    }

    return {
      osmId: userData.sub,
      displayName: userData.preferred_username ?? `osm_${userData.sub}`,
    };
  } catch (error) {
    console.error("OSM auth error:", error);
    return null;
  }
}
