import pino from "pino";
import build from "pino-roll";
import fs from "fs";
import path from "path";

// AI : Ensure logs directory exists
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// AI : Configure pino logger - pretty print in dev, file rotation in production
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
            // AI : Custom message format for compact, readable logs
            messageFormat: "{method} {path} → {status} ({duration}ms)",
          },
        },
      })
    : pino(
        {
          level: process.env.LOG_LEVEL ?? "info",
        },
        // AI : Production: Use pino-roll stream directly (static import works with bundlers)
        build({
          file: path.join(logsDir, "access.log"),
          frequency: "daily",
          dateFormat: "yyyy-MM-dd",
          size: "10m",
          // AI : Keep logs for 15 days
          limit: {
            count: 15,
          },
        }),
      );

// AI : Log server startup
logger.info({ event: "server_startup", env: process.env.NODE_ENV }, "Logger initialized");
