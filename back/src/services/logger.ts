import pino from "pino";

// Configure pino logger - pretty in dev, JSON stdout in production
// Production logs are shipped to Grafana Loki via Alloy
export const logger =
  process.env.NODE_ENV === "development"
    ? pino({
        level: process.env.LOG_LEVEL ?? "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            singleLine: true,
            // Custom message format for compact, readable logs
            messageFormat: "{method} {path} → {status} ({duration}ms)",
          },
        },
      })
    : pino({
        level: process.env.LOG_LEVEL ?? "info",
        // Production: JSON to stdout
        // Grafana Alloy captures stdout and ships to Loki
      });

// Log server startup
logger.info({ event: "server_startup", env: process.env.NODE_ENV }, "Logger initialized");
