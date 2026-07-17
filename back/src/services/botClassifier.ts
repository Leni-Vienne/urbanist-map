// Classifies each request as bot or human at request time, so Grafana can group on the verdict
// instead of needing DNS and CIDR lookups that LogQL cannot do.
//
// Only the tiers that need no DNS are implemented here: published crawler ranges, scanner probes,
// and self-declared User-Agents. Forward-confirmed rDNS, ASN ownership, and datacenter PTR need a
// resolver and stay in the offline deep pass (scripts/analyze-visitors.ts), which remains the
// authority. Treat these labels as the cheap live view, not as the final word.
//
// Evidence accumulates per IP for the length of a session, because the strongest signals are
// properties of a visitor rather than of a single request: one request for /api/check-session says
// nothing on its own, and an IP that probed /.env stays a scanner for its later requests too.

import { logger } from "./logger";
import {
  BOT_UA_RE,
  HUMAN_SIGNAL_PATHS,
  SCANNER_PATH_RE,
  VERIFIABLE_CLAIMS,
  botNameFromUa,
  cidrContains,
  fetchRangePrefixes,
  ipKey64,
  ipToBigInt,
  parseRangePrefixes,
  type Cidr,
} from "./botSignatures";

export type BotClass = "official-range" | "scanner" | "declared-bot" | "human-likely" | "unknown";
export type BotKind = "bot" | "human" | "unknown";

export interface Verdict {
  botClass: BotClass;
  botKind: BotKind;
  botOperator: string;
  impostor: boolean;
}

const RANGE_REFRESH_MS = 24 * 60 * 60 * 1000;
// A failed refresh costs the strongest tier, so retry well before the next daily slot.
const RANGE_RETRY_MS = 15 * 60 * 1000;
// The gap that ends a session, matching the offline script and the GA convention.
const SESSION_GAP_MS = 30 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
// Bounds memory if a flood of unique IPs arrives. Entries are ~100 bytes, so this caps the map in
// the low megabytes.
const MAX_TRACKED_IPS = 50_000;

interface Evidence {
  // Which range set the lookup was done against, so a refresh re-checks instead of trusting a
  // "no hit" that was cached while the list was empty or stale. -1 means never checked.
  rangeCheckedVersion: number;
  rangeOperator?: string;
  scanner: boolean;
  humanSignal: boolean;
  claimed?: string;
  lastSeen: number;
}

let ranges: Cidr[] = [];
let rangeVersion = 0;

// Insertion-ordered as an LRU: reads re-insert, so the oldest key is always the eviction candidate.
const evidenceByIp = new Map<string, Evidence>();

const UNKNOWN_VERDICT: Verdict = {
  botClass: "unknown",
  botKind: "unknown",
  botOperator: "unknown",
  impostor: false,
};

function rangeOperatorFor(ip: string): string | undefined {
  const parsed = ipToBigInt(ip);
  if (!parsed) return undefined;
  const hit = ranges.find(function inRange(c) {
    return cidrContains(c, parsed);
  });
  return hit?.operator;
}

function evictOverflow(): void {
  while (evidenceByIp.size > MAX_TRACKED_IPS) {
    const oldest = evidenceByIp.keys().next();
    if (oldest.done) break;
    evidenceByIp.delete(oldest.value);
  }
}

function evidenceFor(key: string, now: number): Evidence {
  const existing = evidenceByIp.get(key);
  if (existing && now - existing.lastSeen <= SESSION_GAP_MS) {
    // Re-insert to move this key to the LRU tail.
    evidenceByIp.delete(key);
    evidenceByIp.set(key, existing);
    return existing;
  }
  const fresh: Evidence = {
    rangeCheckedVersion: -1,
    scanner: false,
    humanSignal: false,
    lastSeen: now,
  };
  evidenceByIp.delete(key);
  evidenceByIp.set(key, fresh);
  evictOverflow();
  return fresh;
}

// Evidence is applied strongest first. Behaviour outranks self-declaration, because a User-Agent is
// an unauthenticated claim that a scanner can set to anything.
function verdictFrom(e: Evidence): Verdict {
  if (e.rangeOperator) {
    return {
      botClass: "official-range",
      botKind: "bot",
      botOperator: e.rangeOperator,
      impostor: false,
    };
  }

  // No published range backs this IP, so any verifiable identity it claims here is forged.
  const impostor = e.claimed !== undefined && VERIFIABLE_CLAIMS.includes(e.claimed);

  if (e.scanner) return { botClass: "scanner", botKind: "bot", botOperator: "scanner", impostor };
  if (e.claimed) {
    return {
      botClass: "declared-bot",
      botKind: "bot",
      botOperator: impostor ? "impostor" : e.claimed,
      impostor,
    };
  }
  if (e.humanSignal) {
    return { botClass: "human-likely", botKind: "human", botOperator: "human", impostor: false };
  }
  return { ...UNKNOWN_VERDICT, impostor };
}

// Runs on every logged request, so it must never throw: a failure here would turn every response
// into a 500.
export function classifyRequest(ip: string, path: string, userAgent: string | undefined): Verdict {
  try {
    const now = Date.now();
    const e = evidenceFor(ipKey64(ip), now);
    e.lastSeen = now;

    if (e.rangeCheckedVersion !== rangeVersion) {
      e.rangeOperator = rangeOperatorFor(ip);
      e.rangeCheckedVersion = rangeVersion;
    }
    if (userAgent && BOT_UA_RE.test(userAgent)) e.claimed = botNameFromUa(userAgent);
    if (SCANNER_PATH_RE.test(path)) e.scanner = true;
    if (
      HUMAN_SIGNAL_PATHS.some(function isBrowserOnly(h) {
        return path.startsWith(h);
      })
    ) {
      e.humanSignal = true;
    }

    return verdictFrom(e);
  } catch (error) {
    logger.warn(
      {
        event: "bot_classify_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Bot classification failed",
    );
    return UNKNOWN_VERDICT;
  }
}

async function refreshRanges(): Promise<void> {
  let next = RANGE_RETRY_MS;
  try {
    const raw = await fetchRangePrefixes(function report(operator, error) {
      logger.warn(
        {
          event: "crawler_ranges_source_failed",
          operator,
          error: error instanceof Error ? error.message : String(error),
        },
        "Crawler range source unavailable",
      );
    });
    const parsed = parseRangePrefixes(raw);
    if (parsed.length > 0) {
      ranges = parsed;
      rangeVersion += 1;
      next = RANGE_REFRESH_MS;
      logger.info(
        {
          event: "crawler_ranges_loaded",
          cidrs: parsed.length,
          operators: Object.keys(raw).length,
        },
        "Crawler ranges loaded",
      );
    } else {
      // Keep whatever the previous refresh loaded rather than dropping to no tier at all.
      logger.warn(
        { event: "crawler_ranges_empty", cidrs: ranges.length },
        "Crawler ranges empty, keeping previous set",
      );
    }
  } catch (error) {
    logger.warn(
      {
        event: "crawler_ranges_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Crawler range refresh failed",
    );
  }
  setTimeout(function scheduleRefresh() {
    void refreshRanges();
  }, next);
}

export function startBotClassifier(): void {
  // Not awaited: until the first fetch lands, requests classify without the published-range tier
  // rather than blocking startup on a third-party endpoint.
  void refreshRanges();

  setInterval(function sweepIdle() {
    const cutoff = Date.now() - SESSION_GAP_MS;
    for (const [key, e] of evidenceByIp) {
      if (e.lastSeen < cutoff) evidenceByIp.delete(key);
    }
  }, SWEEP_MS);
}
