import { customType } from "drizzle-orm/pg-core";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { JsonObject } from "@shared/json";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// SQL queries bypass fromDriver. Accept the same object/string formats here so JSON key and
// array operations work with old Bun writes and ordinary jsonb objects alike. Validate before
// casting: one malformed string must not abort a bulk indexing refresh (PostgreSQL 16+).
export function jsonObjectSql(value: SQLWrapper): SQL<JsonObject | null> {
  const text = sql`(${value} #>> '{}')`;
  // Guard the cast's input itself, including when PostgreSQL folds constant expressions.
  const parsed = sql`((CASE WHEN pg_input_is_valid(${text}, 'jsonb') THEN ${text} END)::jsonb)`;
  return sql`CASE jsonb_typeof(${value})
    WHEN 'object' THEN ${value}
    WHEN 'string' THEN CASE
      WHEN jsonb_typeof(${parsed}) = 'object' THEN ${parsed}
    END
  END`;
}

// Bun SQL has stored some jsonb objects as JSON strings (oven-sh/bun#28819).
// Normalize this object-valued column on reads so every API consumer sees the same shape.
export const jsonObject = customType<{ data: JsonObject | null; driverData: unknown }>({
  dataType() {
    return "jsonb";
  },
  codec: "jsonb",
  fromDriver(value): JsonObject | null {
    let parsed: unknown = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    return isJsonObject(parsed) ? parsed : null;
  },
});
