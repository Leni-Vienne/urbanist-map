import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";

const runId = process.env.OSM_RUN_ID || randomUUID();

// One JSON record per write, including escaped multiline errors. Numeric metrics
// stay numeric so Loki can unwrap them without parsing a human-readable message.
export function logOsmEvent(
  component: string,
  event: string,
  fields: Record<string, unknown> = {},
  level: "info" | "warning" | "error" = "info",
): void {
  const record = JSON.stringify(
    {
      ...fields,
      time: new Date().toISOString(),
      level,
      component,
      run_id: runId,
      dry_run: 0,
      event,
    },
    (_key, value) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
        : value,
  );
  // Scripts exit explicitly after closing their DB client; flush before exit.
  writeSync(level === "info" ? 1 : 2, record + "\n");
}
