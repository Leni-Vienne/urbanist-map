// Shared Zod validation schemas for frontend and backend
import * as z from "zod";
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import { validateOverlaySize } from "../overlayValidation";

// Project validation schema
export const projectSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(7, "validation.nameTooShort").max(35, "validation.nameTooLong"),
    description: z
      .string()
      .max(2000, "validation.descriptionTooLong")
      .or(z.literal(""))
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
    cityId: z.number({ message: "validation.cityRequired" }),
    lat: z
      .number({ message: "validation.invalidLatitude" })
      .min(-90, "validation.invalidLatitude")
      .max(90, "validation.invalidLatitude"),
    lng: z
      .number({ message: "validation.invalidLongitude" })
      .min(-180, "validation.invalidLongitude")
      .max(180, "validation.invalidLongitude"),
    proposalDate: z.date({ message: "validation.invalidDate" }).nullable().optional(),
    proposalDatePrecision: z.enum(["year", "month", "day"]).nullable().optional(),
    startDate: z.date({ message: "validation.invalidDate" }).nullable().optional(),
    startDatePrecision: z.enum(["year", "month", "day"]).nullable().optional(),
    endDate: z.date({ message: "validation.invalidDate" }).nullable().optional(),
    endDatePrecision: z.enum(["year", "month", "day"]).nullable().optional(),
    sourceUrl: z
      .string()
      .url("validation.invalidUrl")
      .or(z.literal(""))
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
    geometry: GeoJSONGeometryCollectionSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Validate proposal date is not in the future
    if (data.proposalDate && data.proposalDate > new Date()) {
      ctx.addIssue({
        code: "custom",
        message: "validation.proposalDateFuture",
        path: ["proposalDate"],
      });
    }

    // Validate project has either proposalDate OR (startDate AND endDate) OR (endDate ONLY for already started)
    const hasProposalDate = data.proposalDate !== null;
    const hasPlannedDates =
      (data.startDate !== null && data.endDate !== null) || data.endDate !== null; // Allow EndDate only (implies already started)

    if (!hasProposalDate && !hasPlannedDates) {
      ctx.addIssue({
        code: "custom",
        message: "validation.timelineRequired",
        path: ["proposalDate"],
      });
    }

    // Validate end date is after start date
    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "validation.endDateBeforeStartDate",
        path: ["endDate"],
      });
    }
  });

// Overlay validation schema
export const overlaySchema = z
  .object({
    id: z.uuid(),
    filename: z
      .string()
      .min(1, "validation.filenameRequired")
      .max(255, "validation.filenameTooLong"),
    caption: z
      .string()
      .max(500, "validation.captionTooLong")
      .or(z.literal(""))
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
    projectId: z.uuid({ message: "validation.projectRequired" }),
    replacesOverlayId: z.uuid().optional(),
    corners: z
      .array(
        z.object({
          lat: z
            .number()
            .min(-90, "validation.invalidLatitude")
            .max(90, "validation.invalidLatitude"),
          lng: z
            .number()
            .min(-180, "validation.invalidLongitude")
            .max(180, "validation.invalidLongitude"),
        }),
      )
      .length(4, "validation.cornersRequired"),
  })
  .superRefine((data, ctx) => {
    // Validate overlay size constraints (max dimensions in meters)
    const sizeValidation = validateOverlaySize(data.corners);
    if (!sizeValidation.isValid) {
      ctx.addIssue({
        code: "custom",
        message: "overlay.overlayTooLarge",
        path: ["corners"],
      });
    }
  });

// Auth validation schemas
export const registerSchema = z.object({
  email: z.string().email("validation.invalidEmail"),
  password: z.string().min(8, "validation.passwordTooShort"),
  username: z.string().min(3, "validation.usernameTooShort").max(50, "validation.usernameTooLong"),
  captchaToken: z.string().optional(), // Optional Cloudflare Turnstile token
});

export const resetPasswordRequestSchema = z.object({
  email: z.email("validation.invalidEmail"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "validation.tokenRequired"),
  password: z.string().min(8, "validation.passwordTooShort"),
});

// Allowed field names per entity type and their value validators
const PROJECT_FIELD_VALIDATORS: Record<string, z.ZodTypeAny> = {
  name: z.string().min(1).max(35),
  description: z.string().max(2000).or(z.literal("")).nullable(),
  sourceUrl: z.url().or(z.literal("")).nullable(),
  proposalDate: z.coerce.date().nullable(),
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  proposalDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  startDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  endDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  cityId: z.number().int().positive(),
  geometry: GeoJSONGeometryCollectionSchema.nullable(),
};

const OVERLAY_FIELD_VALIDATORS: Record<string, z.ZodTypeAny> = {
  caption: z.string().max(500).or(z.literal("")).nullable(),
  corners: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .length(4),
};

// Change request validation schema
export const submitChangeRequestSchema = z
  .object({
    entityType: z.enum(["project", "overlay"]),
    entityId: z.uuid(),
    changes: z
      .array(
        z.object({
          fieldName: z.string().min(1, "validation.fieldNameRequired"),
          oldValue: z.any().optional(),
          newValue: z.any(),
          changeReason: z
            .string()
            .or(z.literal(""))
            .transform((val) => (val === "" ? undefined : val))
            .optional(),
        }),
      )
      .min(1, "validation.changesRequired"),
  })
  .superRefine((data, ctx) => {
    const validators =
      data.entityType === "project" ? PROJECT_FIELD_VALIDATORS : OVERLAY_FIELD_VALIDATORS;

    data.changes.forEach((change, i) => {
      const validator = validators[change.fieldName];

      if (!validator) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid field name "${change.fieldName}" for entity type "${data.entityType}"`,
          path: ["changes", i, "fieldName"],
        });
        return;
      }

      const result = validator.safeParse(change.newValue);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ["changes", i, "newValue", ...issue.path],
          });
        }
      }
    });
  });

// Validation error with i18n key and parameters
export interface ValidationError {
  key: string;
  params?: Record<string, any>;
}

// Helper function to extract i18n key and params from ZodError
export function getValidationError(error: z.ZodError, fieldPath?: string): ValidationError {
  const issues = fieldPath
    ? error.issues.filter((issue) => issue.path.join(".") === fieldPath)
    : error.issues;

  const issue = issues[0];
  if (!issue) {
    return { key: "validation.genericError" };
  }
  const key = issue?.message.startsWith("validation.") ? issue.message : "validation.genericError";

  // Extract constraint values from Zod issue for dynamic i18n parameters
  const params: Record<string, any> = {};

  if (issue.code === "too_small") {
    params.min = issue.minimum;
    params.expected = issue.minimum;
  } else if (issue.code === "too_big") {
    params.max = issue.maximum;
    params.expected = issue.maximum;
  }

  return { key, params: Object.keys(params).length > 0 ? params : undefined };
}

// Helper function to get all validation errors as a map of field -> ValidationError
export function getValidationErrorsMap(error: z.ZodError): Record<string, ValidationError> {
  const errorMap: Record<string, ValidationError> = {};

  for (const issue of error.issues) {
    const fieldPath = issue.path.join(".");
    if (!errorMap[fieldPath]) {
      const key = issue?.message.startsWith("validation.")
        ? issue.message
        : "validation.genericError";
      const params: Record<string, any> = {};

      // Extract constraint values from Zod issue
      if (issue.code === "too_small") {
        params.min = issue.minimum;
        params.expected = issue.minimum;
      } else if (issue.code === "too_big") {
        params.max = issue.maximum;
        params.expected = issue.maximum;
      }

      errorMap[fieldPath] = { key, params: Object.keys(params).length > 0 ? params : undefined };
    }
  }

  return errorMap;
}

// Type exports for TypeScript inference
export type SubmitChangeRequestInput = z.infer<typeof submitChangeRequestSchema>;
export type FieldChange = SubmitChangeRequestInput["changes"][number];
