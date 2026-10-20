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

const projectFieldsSchema = z.object({
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
    .optional(),
  sourceUrl: safeUrl
    .or(z.literal(""))
    .transform((val) => (val === "" ? undefined : val))
    .nullish()
    .transform((val) => val ?? undefined),
  geometry: GeoJSONGeometryCollectionSchema.nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

type ProjectDates = {
  proposalDate?: Date | null;
  startDate?: Date | null;
  endDate?: Date | null;
};

function checkProjectDates(data: ProjectDates, ctx: z.RefinementCtx): void {
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
}

export const projectSchema = projectFieldsSchema
  .extend({ timelineStatus: projectFieldsSchema.shape.timelineStatus.default("proposed") })
  .superRefine(checkProjectDates);

// Existing projects may carry imported values outside creation rules. Only supplied fields are
// validated; the server checks date relationships against the persisted project as well.
export const projectPatchSchema = projectFieldsSchema
  .omit({ id: true, lat: true, lng: true })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "validation.changesRequired")
  .superRefine((patch, ctx) => {
    // These fields cannot be cleared. Optional means omitted, not undefined becoming a null write.
    for (const field of ["name", "timelineStatus", "tags"] as const) {
      if (field in patch && patch[field] === undefined) {
        ctx.addIssue({ code: "custom", message: "validation.fieldNameInvalid", path: [field] });
      }
    }
  })
  .superRefine(checkProjectDates);

export type ProjectPatch = z.input<typeof projectPatchSchema>;
export type SubmittedProject = z.infer<typeof projectSchema> & { id: string };

export function validateProjectPatch(patch: unknown, baseline: ProjectDates) {
  return projectPatchSchema
    .superRefine((changes, ctx) => {
      if ("startDate" in changes || "endDate" in changes) {
        checkProjectDates(
          { startDate: baseline.startDate, endDate: baseline.endDate, ...changes },
          ctx,
        );
      }
    })
    .safeParse(patch);
}

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

export const PROJECT_CHANGE_FIELDS = [
  "name",
  "description",
  "sourceUrl",
  "timelineStatus",
  "proposalDate",
  "startDate",
  "endDate",
  "endDatePrecision",
  "proposalDatePrecision",
  "startDatePrecision",
  "geometry",
  "tags",
] as const;

const OVERLAY_CHANGE_FIELDS = ["caption", "corners"] as const;

// Include coordinate fields stored by older change-request submissions.
export const CHANGE_REQUEST_FIELDS = [
  ...PROJECT_CHANGE_FIELDS,
  ...OVERLAY_CHANGE_FIELDS,
  "centroid",
  "centerCoordinate",
] as const;
export type ChangeRequestFieldName = (typeof CHANGE_REQUEST_FIELDS)[number];

export type ProjectFieldName = (typeof PROJECT_CHANGE_FIELDS)[number];
export type OverlayFieldName = (typeof OVERLAY_CHANGE_FIELDS)[number];

const overlayCornersSchema = z
  .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
  .length(4);

export type OverlayCorners = z.infer<typeof overlayCornersSchema>;

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const changedOverlayFieldsSchema = z
  .array(z.enum(OVERLAY_CHANGE_FIELDS))
  .max(OVERLAY_CHANGE_FIELDS.length)
  .refine(hasUniqueValues, "validation.fieldNameInvalid");

const submittedProjectSchema = z.union([
  z.strictObject({ id: z.uuid(), create: projectSchema }),
  z.strictObject({ id: z.uuid(), patch: projectPatchSchema }),
]);

const submittedOverlaySchema = overlaySchema.and(
  z.object({ changedFields: changedOverlayFieldsSchema }),
);

export const submissionBatchSchema = z
  .object({
    projectId: z.uuid(),
    project: submittedProjectSchema.optional(),
    overlays: z.array(submittedOverlaySchema),
    render: z.object({ id: z.uuid(), filename: uploadedFilenameSchema }).optional(),
    reason: z
      .string()
      .or(z.literal(""))
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.project && data.overlays.length === 0 && !data.render) {
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

export type SubmissionBatchInput = z.infer<typeof submissionBatchSchema>;
