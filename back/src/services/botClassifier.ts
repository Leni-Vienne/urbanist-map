import { isBot } from "isbot";
import { logger } from "./logger";

type BotClass = "scanner" | "declared-bot" | "human-likely" | "unknown";
type BotKind = "bot" | "human" | "unknown";

export interface Verdict {
  botClass: BotClass;
  botKind: BotKind;
}

const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_TRACKED_IPS = 50_000;

const SCANNER_PATH_RE =
  /(?:\/\.env)|(?:\.env\.)|(?:\/\.git)|(?:wp-admin)|(?:wp-login)|(?:wp-includes)|(?:wp-content)|(?:xmlrpc\.php)|(?:phpmyadmin)|(?:\/vendor\/)|(?:\/\.aws)|(?:\/\.ssh)|(?:secrets?\.json)|(?:credentials\.json)|(?:gcp-credentials)|(?:\/config\.json)|(?:\/api\/env)|(?:\/actuator)|(?:\/solr\/)|(?:\/cgi-bin\/)|(?:\.php$)|(?:\/telescope)|(?:\/server-status)/i;

const HUMAN_SIGNAL_PATHS = ["/api/check-session", "/uploads/"];

interface Evidence {
  scanner: boolean;
  humanSignal: boolean;
  lastSeen: number;
}

const evidenceByIp = new Map<string, Evidence>();

const UNKNOWN_VERDICT: Verdict = {
  botClass: "unknown",
  botKind: "unknown",
};

function evictOverflow(): void {
  while (evidenceByIp.size > MAX_TRACKED_IPS) {
    const oldest = evidenceByIp.keys().next();
    if (oldest.done) break;
    evidenceByIp.delete(oldest.value);
  }
}

function evidenceFor(ip: string, now: number): Evidence {
  const existing = evidenceByIp.get(ip);
  if (existing && now - existing.lastSeen <= SESSION_GAP_MS) {
    evidenceByIp.delete(ip);
    evidenceByIp.set(ip, existing);
    return existing;
  }

  const fresh: Evidence = {
    scanner: false,
    humanSignal: false,
    lastSeen: now,
  };
  evidenceByIp.delete(ip);
  evidenceByIp.set(ip, fresh);
  evictOverflow();
  return fresh;
}

function verdictFrom(evidence: Evidence, declaredBot: boolean): Verdict {
  if (evidence.scanner) return { botClass: "scanner", botKind: "bot" };
  if (declaredBot) return { botClass: "declared-bot", botKind: "bot" };
  if (evidence.humanSignal) return { botClass: "human-likely", botKind: "human" };
  return UNKNOWN_VERDICT;
}

export function classifyRequest(ip: string, path: string, userAgent: string | undefined): Verdict {
  function isBrowserOnly(pathPrefix: string): boolean {
    return path.startsWith(pathPrefix);
  }

  try {
    const now = Date.now();
    const evidence = evidenceFor(ip, now);
    const declaredBot = isBot(userAgent);
    evidence.lastSeen = now;

    if (SCANNER_PATH_RE.test(path)) evidence.scanner = true;
    if (!declaredBot && HUMAN_SIGNAL_PATHS.some(isBrowserOnly)) evidence.humanSignal = true;

    return verdictFrom(evidence, declaredBot);
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
