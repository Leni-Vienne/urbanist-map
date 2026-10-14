import { customType } from "drizzle-orm/pg-core";
import type { JsonObject } from "@shared/json";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
