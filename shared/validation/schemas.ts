// Shared Zod validation schemas between frontend and backend
import * as z from "zod";
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import { validateOverlaySize } from "../overlayValidation";

// From Zod doc, way safer than plain z.url(). https://zod.dev/api?id=urls
const safeUrl = z.url({ protocol: /^https?$/, message: "validation.invalidUrl" });

// The upload endpoint names stored images `${timestamp}-${random}.${ext}`. A persisted
// filename is later interpolated into filesystem paths (unlink, readdir) and served, so it
// must match that shape exactly: bare name, no path separators or `..`, single extension.
const uploadedFilenameSchema = z
  .string()
  .min(1, "validation.filenameRequired")
  .max(255, "validation.filenameTooLong")
  .regex(/^[0-9]+-[a-z0-9]+\.[a-z0-9]+$/, "validation.filenameInvalid");

export const projectSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(7, "validation.nameTooShort").max(35, "validation.nameTooLong"),
    description: z
      .string()
      .max(2000, "validation.descriptionTooLong")
      .or(z.literal(""))
      .transform((val) => (val === "" ? undefined : val))
      .nullish()
      .transform((val) => val ?? undefined),
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
    timelineStatus: z
      .enum(["proposed", "planned", "under_construction", "completed", "canceled"])
      .optional()
      .default("proposed"),
    sourceUrl: safeUrl
      .or(z.literal(""))
      .transform((val) => (val === "" ? undefined : val))
      .nullish()
      .transform((val) => val ?? undefined),
    geometry: GeoJSONGeometryCollectionSchema.nullable().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.proposalDate && data.proposalDate > new Date()) {
      ctx.addIssue({
        code: "custom",
        message: "validation.proposalDateFuture",
        path: ["proposalDate"],
      });
    }

    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "validation.endDateBeforeStartDate",
        path: ["endDate"],
      });
    }
  });

const overlayBaseSchema = z.object({
  id: z.uuid(),
  filename: uploadedFilenameSchema,
  caption: z
    .string()
    .max(500, "validation.captionTooLong")
    .or(z.literal(""))
    .nullable()
    .transform((val) => (val === "" ? null : val))
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
});

// The 1km size ceiling, shared by the backend and client overlay schemas.
function withOverlaySizeCheck<
  Schema extends z.ZodType<{ corners: { lat: number; lng: number }[] }>,
>(schema: Schema) {
  return schema.superRefine((data, ctx) => {
    if (!validateOverlaySize(data.corners).isValid) {
      ctx.addIssue({
        code: "custom",
        message: "validation.overlayTooLarge",
        path: ["corners"],
      });
    }
  });
}

// Full payload sent to the backend: the uploaded image's filename is required.
const overlaySchema = withOverlaySizeCheck(overlayBaseSchema);

// Client-side pre-upload check. A brand-new overlay has no filename yet
export const overlayClientSchema = withOverlaySizeCheck(overlayBaseSchema.omit({ filename: true }));

export const registerSchema = z.object({
  email: z.email("validation.invalidEmail"),
  password: z.string().min(8, "validation.passwordTooShort"),
  username: z.string().min(3, "validation.usernameTooShort").max(50, "validation.usernameTooLong"),
  captchaToken: z.string().optional(),
});

export const resetPasswordRequestSchema = z.object({
  email: z.email("validation.invalidEmail"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "validation.tokenRequired"),
  password: z.string().min(8, "validation.passwordTooShort"),
});

// Allowed field names per entity type and their value validators
const PROJECT_FIELD_VALIDATORS = {
  name: z.string().min(1).max(35),
  description: z.string().max(2000).or(z.literal("")).nullable(),
  sourceUrl: safeUrl.or(z.literal("")).nullable(),
  proposalDate: z.coerce.date().nullable(),
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  proposalDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  startDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  endDatePrecision: z.enum(["year", "month", "day"]).nullable(),
  timelineStatus: z
    .enum(["proposed", "planned", "under_construction", "completed", "canceled"])
    .optional(),
  geometry: GeoJSONGeometryCollectionSchema.nullable(),
  tags: z.array(z.string().max(50)).max(20).nullable(),
};

const overlayCornersSchema = z
  .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
  .length(4);

export type OverlayCorners = z.infer<typeof overlayCornersSchema>;

const OVERLAY_FIELD_VALIDATORS = {
  caption: z.string().max(500).or(z.literal("")).nullable(),
  corners: overlayCornersSchema,
};

/** The field names a change request may name, per entity type. */
export type ProjectFieldName = keyof typeof PROJECT_FIELD_VALIDATORS;
export type OverlayFieldName = keyof typeof OVERLAY_FIELD_VALIDATORS;

// Lookup form of the tables above. A wire `fieldName` is an arbitrary string until it matches a
// key here, so it is looked up rather than indexed.
const FIELD_VALIDATORS_BY_ENTITY = {
  project: new Map<string, z.ZodTypeAny>(Object.entries(PROJECT_FIELD_VALIDATORS)),
  overlay: new Map<string, z.ZodTypeAny>(Object.entries(OVERLAY_FIELD_VALIDATORS)),
};

const fieldChangeSchema = z.object({
  fieldName: z.string().min(1, "validation.fieldNameRequired"),
  oldValue: z.any().optional(),
  newValue: z.any(),
  changeReason: z
    .string()
    .or(z.literal(""))
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
});

const submitChangeRequestSchema = z
  .object({
    entityType: z.enum(["project", "overlay"]),
    entityId: z.uuid(),
    changes: z.array(fieldChangeSchema).min(1, "validation.changesRequired"),
  })
  .superRefine((data, ctx) => {
    const validators = FIELD_VALIDATORS_BY_ENTITY[data.entityType];

    data.changes.forEach((change, i) => {
      const validator = validators.get(change.fieldName);

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

export const submissionBatchSchema = z
  .object({
    projectId: z.uuid(),
    project: projectSchema.and(z.object({ id: z.uuid() })).optional(),
    overlays: z.array(overlaySchema),
    changeRequests: z.array(submitChangeRequestSchema),
    render: z.object({ id: z.uuid(), filename: uploadedFilenameSchema }).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      !data.project &&
      data.overlays.length === 0 &&
      data.changeRequests.length === 0 &&
      !data.render
    ) {
      ctx.addIssue({ code: "custom", message: "validation.changesRequired", path: [] });
    }
    if (data.project && data.project.id !== data.projectId) {
      ctx.addIssue({ code: "custom", message: "validation.projectRequired", path: ["project"] });
    }
    data.overlays.forEach((overlay, index) => {
      if (overlay.projectId !== data.projectId) {
        ctx.addIssue({
          code: "custom",
          message: "validation.projectRequired",
          path: ["overlays", index, "projectId"],
        });
      }
    });
    data.changeRequests.forEach((request, index) => {
      if (request.entityType === "project" && request.entityId !== data.projectId) {
        ctx.addIssue({
          code: "custom",
          message: "validation.projectRequired",
          path: ["changeRequests", index, "entityId"],
        });
      }
    });
  });

// Validation error with i18n key and parameters
export interface ValidationError {
  key: string;
  params?: Record<string, string | number>;
}

function issueToValidationError(issue: z.core.$ZodIssue): ValidationError {
  const key = issue.message.startsWith("validation.") ? issue.message : "validation.genericError";

  const params: Record<string, string | number> = {};

  if (issue.code === "too_small") {
    params.min = Number(issue.minimum);
    params.expected = Number(issue.minimum);
  } else if (issue.code === "too_big") {
    params.max = Number(issue.maximum);
    params.expected = Number(issue.maximum);
  }

  return { key, params: Object.keys(params).length > 0 ? params : undefined };
}

export function getValidationError(error: z.ZodError, fieldPath?: string): ValidationError {
  const issues = fieldPath
    ? error.issues.filter((issue) => issue.path.join(".") === fieldPath)
    : error.issues;

  const issue = issues[0];
  if (!issue) {
    return { key: "validation.genericError" };
  }

  return issueToValidationError(issue);
}

// At most one error per field path, in issue order.
export function getValidationErrors(error: z.ZodError): ValidationError[] {
  const seenPaths = new Set<string>();
  const errors: ValidationError[] = [];

  for (const issue of error.issues) {
    const fieldPath = issue.path.join(".");
    if (seenPaths.has(fieldPath)) continue;
    seenPaths.add(fieldPath);
    errors.push(issueToValidationError(issue));
  }

  return errors;
}

type SubmitChangeRequestInput = z.infer<typeof submitChangeRequestSchema>;
export type FieldChange = SubmitChangeRequestInput["changes"][number];
export type SubmissionBatchInput = z.infer<typeof submissionBatchSchema>;
