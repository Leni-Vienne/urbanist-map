// Value types of a parsed JSON payload: jsonb columns, fetched API responses, uploaded GeoJSON.
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };
