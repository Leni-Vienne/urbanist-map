// Get API URL based on environment.
// In dev with no explicit base, use the page's own origin so requests go through the
// Vite proxy. This keeps the backend same-origin as the page, so the session cookie
// stays first-party whether the page is loaded via localhost or a LAN IP.
export function getApiUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (!configured && import.meta.env.DEV) {
    return globalThis.location.origin;
  }
  return configured;
}
