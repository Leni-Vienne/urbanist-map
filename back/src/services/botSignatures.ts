// Signatures and IP primitives shared by the request-time classifier (botClassifier.ts) and the
// offline deep-pass script (scripts/analyze-visitors.ts). Both must agree on what counts as a
// scanner probe or a self-declared bot, so the definitions live in one place.
//
// Everything here is pure: no timers, no state, no logging. The network calls are explicit.

export interface Cidr {
  base: bigint;
  bits: number;
  size: number;
  operator: string;
}

// Operators that publish the IP ranges their crawlers egress from. Fetched at runtime because
// they change without notice.
export const RANGE_SOURCES: Record<string, string> = {
  "OpenAI SearchBot": "https://openai.com/searchbot.json",
  "OpenAI GPTBot": "https://openai.com/gptbot.json",
  "OpenAI ChatGPT-User": "https://openai.com/chatgpt-user.json",
  Googlebot: "https://developers.google.com/search/apis/ipranges/googlebot.json",
  "Google special-crawlers":
    "https://developers.google.com/search/apis/ipranges/special-crawlers.json",
  Bingbot: "https://www.bing.com/toolbox/bingbot.json",
  Applebot: "https://search.developer.apple.com/applebot.json",
};

export const BOT_UA_RE =
  /bot\b|bot\/|crawl|spider|slurp|\/scan|scanner|probe|curl|wget|python-requests|go-http-client|libwww|okhttp|java\/|headless|phantomjs|masscan|zgrab|nuclei|facebookexternalhit|semrush|ahrefs|mj12|dotbot|petal|bytespider|gptbot|ccbot|claudebot|perplexity|applebot|duckduck|chatgpt-user/i;

export const SCANNER_PATH_RE =
  /(\/\.env)|(\.env\.)|(\/\.git)|(wp-admin)|(wp-login)|(wp-includes)|(wp-content)|(xmlrpc\.php)|(phpmyadmin)|(\/vendor\/)|(\/\.aws)|(\/\.ssh)|(secrets?\.json)|(credentials\.json)|(gcp-credentials)|(\/config\.json)|(\/api\/env)|(\/actuator)|(\/solr\/)|(\/cgi-bin\/)|(\.php$)|(\/telescope)|(\/server-status)/i;

// Endpoints the SPA fires from a browser. A plain HTTP fetcher has no reason to request them.
export const HUMAN_SIGNAL_PATHS = ["/api/check-session", "/uploads/"];

// Identities whose operators publish ranges or support forward-confirmed rDNS. Claiming one of
// these from an IP that satisfies neither check proves the User-Agent is forged.
export const VERIFIABLE_CLAIMS = [
  "Googlebot",
  "Google-CloudVertexBot",
  "bingbot",
  "Applebot",
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "YandexBot",
  "Baiduspider",
];

export function botNameFromUa(ua: string): string {
  const m = ua.match(
    /(OAI-SearchBot|ChatGPT-User|GPTBot|ClaudeBot|PerplexityBot|CCBot|Googlebot|Google-CloudVertexBot|bingbot|YandexBot|Baiduspider|Applebot|AhrefsBot|SemrushBot|xAI-SearchBot|DeepSeekBot|wpbot|CMS-Checker|[A-Za-z-]*[Bb]ot[A-Za-z-]*)/,
  );
  return m?.[1] ?? "unnamed bot";
}

export function expandV6(ip: string): string {
  const zone = ip.split("%")[0] ?? ip;
  const [head, tail] = zone.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return full
    .map(function pad(g: string) {
      return (g || "0").padStart(4, "0");
    })
    .join(":");
}

export function ipToBigInt(ip: string): { value: bigint; size: number } | undefined {
  try {
    if (ip.includes(":")) {
      const groups = expandV6(ip).split(":");
      if (groups.length !== 8) return undefined;
      let v = 0n;
      for (const g of groups) {
        const n = parseInt(g, 16);
        if (!Number.isInteger(n) || n < 0 || n > 0xffff) return undefined;
        v = (v << 16n) | BigInt(n);
      }
      return { value: v, size: 128 };
    }
    const octets = ip.split(".");
    if (octets.length !== 4) return undefined;
    let v = 0n;
    for (const o of octets) {
      const n = Number(o);
      if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
      v = (v << 8n) | BigInt(n);
    }
    return { value: v, size: 32 };
  } catch {
    return undefined;
  }
}

export function parseCidr(cidr: string, operator: string): Cidr | undefined {
  const [addr, bitsRaw] = cidr.split("/");
  if (addr === undefined) return undefined;
  const parsed = ipToBigInt(addr);
  if (!parsed) return undefined;
  const bits = bitsRaw === undefined ? parsed.size : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > parsed.size) return undefined;
  const hostBits = BigInt(parsed.size - bits);
  return { base: (parsed.value >> hostBits) << hostBits, bits, size: parsed.size, operator };
}

export function cidrContains(c: Cidr, parsed: { value: bigint; size: number }): boolean {
  if (parsed.size !== c.size) return false;
  const hostBits = BigInt(c.size - c.bits);
  return (parsed.value >> hostBits) << hostBits === c.base;
}

// IPv6 privacy extensions rotate the low 64 bits, so the /64 is the stable per-household unit.
export function ipKey64(ip: string): string {
  if (!ip.includes(":")) return ip;
  return `${expandV6(ip).split(":").slice(0, 4).join(":")}::/64`;
}

// Fetches the published prefix lists. Each source is independent: one operator being unreachable
// costs that operator's ranges, not the whole set. onError reports per-source failures to whatever
// logger the caller uses.
export async function fetchRangePrefixes(
  onError?: (operator: string, error: unknown) => void,
): Promise<Record<string, string[]>> {
  const raw: Record<string, string[]> = {};
  for (const [operator, url] of Object.entries(RANGE_SOURCES)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { prefixes?: Record<string, string | undefined>[] };
      raw[operator] = (body.prefixes ?? [])
        .map(function pick(p) {
          return p.ipv4Prefix ?? p.ipv6Prefix ?? p.ipv4 ?? p.ipv6;
        })
        .filter(function present(p): p is string {
          return Boolean(p);
        });
    } catch (error) {
      onError?.(operator, error);
      raw[operator] = [];
    }
  }
  return raw;
}

export function parseRangePrefixes(raw: Record<string, string[]>): Cidr[] {
  const out: Cidr[] = [];
  for (const [operator, prefixes] of Object.entries(raw)) {
    for (const p of prefixes) {
      const c = parseCidr(p, operator);
      if (c) out.push(c);
    }
  }
  return out;
}
