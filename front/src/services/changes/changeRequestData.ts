import * as z from "zod";
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import { CHANGE_REQUEST_FIELDS } from "@shared/validation/schemas";
import type { PendingChangeRequest, PendingChangeRequestWire } from "@/types/index";

// Imported by data loaders on demand, so validation stays out of the initial map bundle.
const changeFieldSchema = z.enum(CHANGE_REQUEST_FIELDS);
const changeGeometrySchema = GeoJSONGeometryCollectionSchema.nullable();

export function changeRequestFromWire(data: PendingChangeRequestWire): PendingChangeRequest {
  const fieldName = changeFieldSchema.parse(data.fieldName);
  if (fieldName !== "geometry") return { ...data, fieldName };

  const oldValue = changeGeometrySchema.safeParse(data.oldValue);
  const newValue = changeGeometrySchema.safeParse(data.newValue);
  return {
    ...data,
    fieldName,
    oldValue: oldValue.success ? oldValue.data : undefined,
    newValue: newValue.success ? newValue.data : undefined,
  };
}
