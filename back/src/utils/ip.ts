import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export function getClientIp(c: Context): string {
  // Cloudflare specific header (most secure if behind Cloudflare)
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;

  // Standard forwarded header (can contain multiple IPs, first is client)
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    return (forwardedFor.split(",")[0] ?? "").trim();
  }

  // Fallback to direct connection IP (for local dev)
  return getConnInfo(c).remote.address ?? "unknown";
}
