import * as z from "zod";
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import { CHANGE_REQUEST_FIELDS } from "@shared/validation/schemas";
import type { PendingChangeRequest, PendingChangeRequestWire } from "@/types/index";

// Imported by data loaders on demand, so validation stays out of the initial map bundle.
const changeFieldSchema = z.enum(CHANGE_REQUEST_FIELDS);
const changeGeometrySchema = GeoJSONGeometryCollectionSchema.nullable();

export function changeRequestsFromWire(rows: PendingChangeRequestWire[]): PendingChangeRequest[] {
  const requests: PendingChangeRequest[] = [];
  for (const data of rows) {
    const field = changeFieldSchema.safeParse(data.fieldName);
    if (!field.success) {
      console.warn("Ignoring change request with unsupported field", data.id, data.fieldName);
      continue;
    }

    const fieldName = field.data;
    if (fieldName !== "geometry") {
      requests.push({ ...data, fieldName });
      continue;
    }

    const oldValue = changeGeometrySchema.safeParse(data.oldValue);
    const newValue = changeGeometrySchema.safeParse(data.newValue);
    requests.push({
      ...data,
      fieldName,
      oldValue: oldValue.success ? oldValue.data : undefined,
      newValue: newValue.success ? newValue.data : undefined,
    });
  }
  return requests;
}
