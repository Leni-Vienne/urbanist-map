function configuredDomain(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function parseAllowedDomains(value: string): string[] {
  return value
    .split(",")
    .map((entry) => configuredDomain(entry.trim()))
    .filter((domain): domain is string => domain !== null);
}

export const allowedDomains = parseAllowedDomains(process.env.CORS_ORIGIN ?? "");

export function isAllowedCorsOrigin(
  origin: string | undefined,
  domains: readonly string[] = allowedDomains,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
