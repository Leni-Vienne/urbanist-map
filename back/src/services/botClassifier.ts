import { isBot } from "isbot";

type BotClass = "scanner" | "declared-bot" | "human-likely" | "unknown";
type BotKind = "bot" | "human" | "unknown";

export interface Verdict {
  botClass: BotClass;
  botKind: BotKind;
}

const SCANNER_PATH_RE =
  /(?:\/\.env)|(?:\.env\.)|(?:\/\.git)|(?:wp-admin)|(?:wp-login)|(?:wp-includes)|(?:wp-content)|(?:xmlrpc\.php)|(?:phpmyadmin)|(?:\/vendor\/)|(?:\/\.aws)|(?:\/\.ssh)|(?:secrets?\.json)|(?:credentials\.json)|(?:gcp-credentials)|(?:\/config\.json)|(?:\/api\/env)|(?:\/actuator)|(?:\/solr\/)|(?:\/cgi-bin\/)|(?:\.php$)|(?:\/telescope)|(?:\/server-status)/i;

const BROWSER_UA_RE = /\b(?:Chrome|Chromium|CriOS|Firefox|FxiOS|Safari|Edg|OPR)\/\d/i;

// Each request stands on its own. A browser user agent is only a hint: bots can imitate it.
export function classifyRequest(path: string, userAgent: string | undefined): Verdict {
  if (SCANNER_PATH_RE.test(path)) return { botClass: "scanner", botKind: "bot" };
  if (isBot(userAgent)) return { botClass: "declared-bot", botKind: "bot" };
  if (BROWSER_UA_RE.test(userAgent ?? "")) {
    return { botClass: "human-likely", botKind: "human" };
  }
  return { botClass: "unknown", botKind: "unknown" };
}
