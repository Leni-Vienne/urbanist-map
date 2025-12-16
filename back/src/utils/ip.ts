import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export function getClientIp(c: Context): string {
  // AI : Cloudflare specific header (most secure if behind Cloudflare)
  const cfIp = c.req.header("cf-connecting-ip");
  console.log("cfIp", cfIp);
  if (cfIp) return cfIp;

  // AI : Standard forwarded header (can contain multiple IPs, first is client)
  const forwardedFor = c.req.header("x-forwarded-for");
  console.log("forwardedFor", forwardedFor);
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  // AI : Fallback to direct connection IP (for local dev)
  console.log("getConnInfo(c).remote.address (fallback)", getConnInfo(c).remote.address);
  return getConnInfo(c).remote.address || "unknown";
}
