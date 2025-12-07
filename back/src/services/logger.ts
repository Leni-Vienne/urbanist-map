import pino from "pino";
import fs from "fs";
import path from "path";

// AI : Ensure logs directory exists
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// AI : Configure pino logger with file rotation and pretty printing in development
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // AI : In development, use pretty printing for readability
  // AI : In production, use JSON for structured logging
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            singleLine: true,
            // AI : Custom message format for compact, readable logs
            messageFormat: "{method} {path} → {status} ({duration}ms)",
          },
        }
      : {
          targets: [
            // AI : Console output (captured by Docker logs)
            {
              target: "pino/file",
              level: "info",
              options: {
                destination: 1, // stdout
              },
            },
            // AI : File output with daily rotation
            {
              target: "pino-roll",
              level: "info",
              options: {
                file: path.join(logsDir, "access.log"),
                frequency: "daily",
                mkdir: true,
                dateFormat: "yyyy-MM-dd",
                // AI : Keep logs for 15 days
                size: "10m", // Max size per file
                limit: {
                  count: 15, // Keep 15 files (15 days with daily rotation)
                },
              },
            },
          ],
        },
});

// AI : Log server startup
logger.info({ event: "server_startup", env: process.env.NODE_ENV }, "Logger initialized");
