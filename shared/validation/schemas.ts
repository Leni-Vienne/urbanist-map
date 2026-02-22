// AI : Shared Zod validation schemas for frontend and backend
import * as z from "zod";
import { validateOverlaySize } from "../overlayValidation";

// AI : Project validation schema
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
  })
  .superRefine((data, ctx) => {
    // AI : Validate proposal date is not in the future
    if (data.proposalDate && data.proposalDate > new Date()) {
      ctx.addIssue({
        code: "custom",
        message: "validation.proposalDateFuture",
        path: ["proposalDate"],
      });
    }

    // AI : Validate project has either proposalDate OR (startDate AND endDate) OR (endDate ONLY for already started)
    const hasProposalDate = data.proposalDate !== null;
    const hasPlannedDates =
      (data.startDate !== null && data.endDate !== null) || data.endDate !== null; // AI : Allow EndDate only (implies already started)

    if (!hasProposalDate && !hasPlannedDates) {
      ctx.addIssue({
        code: "custom",
        message: "validation.timelineRequired",
        path: ["proposalDate"],
      });
    }

    // AI : Validate end date is after start date
    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "validation.endDateBeforeStartDate",
        path: ["endDate"],
      });
    }
  });

// AI : Overlay validation schema
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
    // AI : Validate overlay size constraints (max dimensions in meters)
    const sizeValidation = validateOverlaySize(data.corners);
    if (!sizeValidation.isValid) {
      ctx.addIssue({
        code: "custom",
        message: "overlay.overlayTooLarge",
        path: ["corners"],
      });
    }
  });

// AI : Auth validation schemas
export const registerSchema = z.object({
  email: z.string().email("validation.invalidEmail"),
  password: z.string().min(8, "validation.passwordTooShort"),
  username: z.string().min(3, "validation.usernameTooShort").max(50, "validation.usernameTooLong"),
  captchaToken: z.string().optional(), // AI : Optional Cloudflare Turnstile token
});

export const resetPasswordRequestSchema = z.object({
  email: z.email("validation.invalidEmail"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "validation.tokenRequired"),
  password: z.string().min(8, "validation.passwordTooShort"),
});

// AI : Change request validation schema
export const submitChangeRequestSchema = z.object({
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
});

// AI : Validation error with i18n key and parameters
export interface ValidationError {
  key: string;
  params?: Record<string, any>;
}

// AI : Helper function to extract i18n key and params from ZodError
export function getValidationError(error: z.ZodError, fieldPath?: string): ValidationError {
  const issues = fieldPath
    ? error.issues.filter((issue) => issue.path.join(".") === fieldPath)
    : error.issues;

  const issue = issues[0];
  if (!issue) {
    return { key: "validation.genericError" };
  }
  const key = issue?.message.startsWith("validation.") ? issue.message : "validation.genericError";

  // AI : Extract constraint values from Zod issue for dynamic i18n parameters
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

// AI : Helper function to get all validation errors as a map of field -> ValidationError
export function getValidationErrorsMap(error: z.ZodError): Record<string, ValidationError> {
  const errorMap: Record<string, ValidationError> = {};

  for (const issue of error.issues) {
    const fieldPath = issue.path.join(".");
    if (!errorMap[fieldPath]) {
      const key = issue?.message.startsWith("validation.")
        ? issue.message
        : "validation.genericError";
      const params: Record<string, any> = {};

      // AI : Extract constraint values from Zod issue
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

// AI : Type exports for TypeScript inference
export type SubmitChangeRequestInput = z.infer<typeof submitChangeRequestSchema>;
export type FieldChange = SubmitChangeRequestInput["changes"][number];
