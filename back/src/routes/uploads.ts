import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import { eq } from "drizzle-orm";
import {
  LocalFileStorage,
  createR2StorageFromEnv,
  readPublicR2File,
  getThumbnailFilename,
  compressImageIfNeeded,
  generateThumbnail,
} from "../lib/storage";
import { exceedsPendingStorageQuota } from "../lib/storageQuota";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { allowedDomains, isAllowedCorsOrigin } from "../lib/corsConfig";
import type { FileUploadResult, AppEnv, SessionUser } from "../lib/types";
import * as rateLimit from "../lib/rateLimit";
import { resolveSessionUser } from "../lib/currentUser";
import { getClientIp } from "../utils/ip";
import { logger } from "../services/logger";
import { db } from "../database";
import { overlays, projects, uploadedFiles } from "../db/schema";

export const uploadsApp = new Hono<AppEnv & { Variables: { uploadUser: SessionUser } }>();

// One backend owns these uploads. Serialize processing and quota checks; the browser
// sends a submission's images sequentially. Reading a slow request must not hold this slot.
let uploadInProgress = false;

// Always use local storage for initial uploads - images migrate to R2 on approval
const storage = new LocalFileStorage();

// Approved images live in R2 and not on local disk. In development, an R2 configuration makes
// them readable, which a database populated by another environment needs.
const readFallbackStorage =
  process.env.NODE_ENV === "development" ? createR2StorageFromEnv() : null;

// Approved images can use the same public CDN as production without S3 credentials.
const publicReadFallbackUrl =
  process.env.NODE_ENV === "development" ? process.env.R2_PUBLIC_URL : undefined;

const filenameParamSchema = z.object({
  filename: z
    .string()
    .min(1, "Filename is required")
    .regex(/^[a-zA-Z0-9\-_./]+$/, "Invalid filename format")
    .refine((name) => !name.includes(".."), "Path traversal not allowed"),
});

// Pending/rejected files are restricted to the author, admins, and moderators of the
// overlay's country. Approved files are public and never reach this check.
function isAuthorizedForOverlay(
  user: SessionUser,
  overlay: { authorId: string | null; countryCode: string | null },
): boolean {
  if (user.role === "admin") return true;
  if (user.id === overlay.authorId) return true;
  return Boolean(overlay.countryCode && user.moderatedCountries?.includes(overlay.countryCode));
}

function buildFileHeaders(
  contentType: string | undefined,
  etagFilename: string,
  isApproved: boolean,
  origin: string | undefined,
): Headers {
  const headers = new Headers({
    "Content-Type": contentType ?? "application/octet-stream",
    // Approved images are public and immutable; pending/rejected are per-user authorized,
    // so they must never be stored by shared caches and replayed to unauthorized clients.
    "Cache-Control": isApproved ? "public, max-age=31536000, must-revalidate" : "private, no-store",
    // Filenames are unique (timestamp-random) and content is immutable once stored,
    // so a filename-based ETag is stable and lets conditional requests return 304.
    ETag: `"${etagFilename}"`,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });

  if (process.env.NODE_ENV === "development") {
    headers.set("Access-Control-Allow-Origin", origin ?? "*");
    headers.set("Access-Control-Allow-Credentials", "true");
  } else if (isAllowedCorsOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin ?? "");
    headers.set("Access-Control-Allow-Credentials", "true");
  } else {
    headers.set(
      "Access-Control-Allow-Origin",
      allowedDomains[0] ? `https://${allowedDomains[0]}` : "",
    );
  }

  return headers;
}

const imageFileSchema = z.object({
  size: z
    .number()
    .max(
      MAX_UPLOAD_FILE_SIZE_BYTES,
      `File too large. Maximum size is ${MAX_UPLOAD_FILE_SIZE_MB}MB`,
    ),
  type: z.enum(["image/jpeg", "image/png", "image/webp"], {
    message: "Invalid file type. Only JPEG, PNG, and WebP are allowed",
  }),
  name: z.string().optional(),
});

// File upload endpoint
uploadsApp.post(
  "/api/upload-image",
  async (c, next) => {
    try {
      // Rate limit: 10 uploads per IP per minute
      const ip = getClientIp(c);
      if (!rateLimit.check(ip, 10, 60 * 1000)) {
        return c.json({ error: "auth.error.tooManyRequests" }, 429);
      }

      // Require authentication
      // Uploads are only allowed for logged-in users to prevent anonymous spam
      const session = c.get("session");
      const user = await resolveSessionUser(session);
      if (!user) {
        return c.json({ error: "Authentication required" }, 401);
      }

      if (uploadInProgress) return c.json({ error: "upload.error.busy" }, 429);
      c.set("uploadUser", user);
      await next();
      return c.res;
    } catch (error) {
      logger.error({ error }, "Failed to authorize image upload");
      return c.json({ error: "upload.error.uploadFailed" }, 500);
    }
  },
  bodyLimit({
    // Allow multipart headers/boundaries in addition to one maximum-size file.
    maxSize: MAX_UPLOAD_FILE_SIZE_BYTES + 64 * 1024,
    onError: (c) => c.json({ error: "upload.error.fileTooLarge" }, 413),
  }),
  async (c) => {
    let ownsUploadSlot = false;
    try {
      const user = c.get("uploadUser");

      const body = await c.req.formData();
      const file = body.get("image");

      if (!(file instanceof File)) {
        logger.warn({ fileType: typeof file }, "Upload failed: No file provided");
        return c.json({ error: "No file provided" }, 400);
      }

      const validationResult = imageFileSchema.safeParse({
        size: file.size,
        type: file.type,
        name: file.name,
      });

      if (!validationResult.success) {
        const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
        logger.warn(
          { fileName: file.name, fileType: file.type, fileSize: file.size, errors: errorMessage },
          "Upload failed: Zod validation error",
        );
        return c.json({ error: errorMessage }, 400);
      }

      // Another request may have entered processing while this one was receiving its body.
      if (uploadInProgress) return c.json({ error: "upload.error.busy" }, 429);
      uploadInProgress = true;
      ownsUploadSlot = true;

      // The original alone must fit before any image decoding/compression is attempted.
      if (await exceedsPendingStorageQuota(user.id, file.size)) {
        return c.json({ error: "upload.error.storageQuotaExceeded" }, 413);
      }

      const originalBuffer = await file.arrayBuffer();

      // Reject malformed or excessive pixel dimensions before allocating decoded pixel buffers.
      // 64 MP permits an 8000x8000 plan; encoded file size alone does not bound decoding cost.
      const imageOptions = { maxPixels: 64_000_000 };
      // oxlint-disable-next-line init-declarations
      let metadata: Bun.Image.Metadata;
      try {
        metadata = await new Bun.Image(originalBuffer, imageOptions).metadata();
      } catch {
        return c.json({ error: "upload.error.invalidImage" }, 400);
      }
      const format = metadata.format;
      if (format !== "jpeg" && format !== "png" && format !== "webp") {
        return c.json({ error: "upload.error.invalidImage" }, 400);
      }
      // Derive stored names from the actual format, never an untrusted filename extension.
      const fileExtension = format === "jpeg" ? "jpg" : format;
      const compressionResult = await compressImageIfNeeded(
        originalBuffer,
        fileExtension,
        imageOptions,
      );
      const thumbnailBuffer = await generateThumbnail(compressionResult.buffer);

      // Account for every byte to be stored, including the thumbnail. The upload slot keeps
      // this check and the following writes from racing another upload's quota check.
      const incomingBytes =
        compressionResult.finalSize + originalBuffer.byteLength + thumbnailBuffer.byteLength;
      if (await exceedsPendingStorageQuota(user.id, incomingBytes)) {
        return c.json({ error: "upload.error.storageQuotaExceeded" }, 413);
      }

      const timestamp = Date.now();
      const randomString = Math.random().toString(36).slice(2, 15);
      const filename = `${timestamp}-${randomString}.${compressionResult.extension}`;
      const originalFilename = `${timestamp}-${randomString}.${fileExtension}`;

      // Claim the filenames before writing them, so bytes that reach disk are always attributable to
      // an uploader even if the request dies mid-write. Recorded here rather than at overlay creation
      // because an upload that is never submitted still occupies local storage.
      await db.insert(uploadedFiles).values({ filename, originalFilename, uploaderId: user.id });

      // Log compression results for monitoring (structured logging for Grafana)
      const savings = compressionResult.originalSize - compressionResult.finalSize;
      const savingsPercent =
        compressionResult.originalSize > 0
          ? ((savings / compressionResult.originalSize) * 100).toFixed(1)
          : "0";

      logger.info(
        {
          event: "image_compression",
          originalName: file.name,
          originalFormat: fileExtension,
          finalFormat: compressionResult.extension,
          originalSize: compressionResult.originalSize,
          finalSize: compressionResult.finalSize,
          savedBytes: savings,
          savingsPercent: Number.parseFloat(savingsPercent),
          wasCompressed: compressionResult.wasCompressed,
        },
        compressionResult.wasCompressed
          ? `Image compressed: ${file.name} (${fileExtension}) → WebP, saved ${(savings / 1024).toFixed(1)}KB (${savingsPercent}%)`
          : `Image kept original: ${file.name} (${compressionResult.extension}), compressed version was not smaller`,
      );

      // The thumbnail was generated above so quota accounting uses its actual size.
      await storage.put(filename, compressionResult.buffer, { skipThumbnail: true });
      await storage.put(getThumbnailFilename(filename), thumbnailBuffer, { skipThumbnail: true });

      // Keep the pre-compression original locally (never migrated to R2) so approved
      // content retains a full-quality source. Rejected files follow the same retention policy.
      try {
        await storage.putOriginal(originalFilename, originalBuffer);
      } catch (error) {
        console.error("Failed to store original image:", error);
      }

      // Always return local URL - images stay in local storage until approved
      const imageUrl = `/uploads/${filename}`;
      const thumbnailUrl = `/uploads/${getThumbnailFilename(filename)}`;

      return c.json({
        success: true,
        filename,
        url: imageUrl,
        thumbnailUrl,
      } as FileUploadResult);
    } catch (error) {
      console.error("Error uploading file:", error);
      return c.json({ error: "Failed to upload file" }, 500);
    } finally {
      if (ownsUploadSlot) uploadInProgress = false;
    }
  },
);

// Serve uploaded files with authorization
// Pending images are only accessible to: author, country moderators, and admins
// Approved images are public (legacy support for approved images still in local storage)
uploadsApp.get("/uploads/*", async (c) => {
  try {
    const filename = c.req.path.replace("/uploads/", "");

    // Validate filename parameter with Zod
    const validationResult = filenameParamSchema.safeParse({ filename });
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage }, 400);
    }

    const validatedFilename = validationResult.data.filename;

    // Thumbnails are served under thumbnails/<name> but the DB row keys on the bare filename.
    const actualFilename = validatedFilename.startsWith("thumbnails/")
      ? validatedFilename.replace("thumbnails/", "")
      : validatedFilename;

    const overlayInfo = await db
      .select({
        authorId: overlays.authorId,
        status: overlays.status,
        countryCode: projects.countryCode,
      })
      .from(overlays)
      .innerJoin(projects, eq(overlays.projectId, projects.id))
      .where(eq(overlays.filename, actualFilename))
      .limit(1);

    const overlay = overlayInfo[0];
    if (!overlay) {
      return c.json({ error: "File not found" }, 404);
    }

    // Approved images are public (legacy support); everything else is access-controlled.
    if (overlay.status !== "approved") {
      const user = await resolveSessionUser(c.get("session"));
      if (!user) {
        return c.json({ error: "Authentication required" }, 401);
      }
      if (!isAuthorizedForOverlay(user, overlay)) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    const file =
      (await storage.get(validatedFilename)) ??
      (overlay.status === "approved" && publicReadFallbackUrl
        ? await readPublicR2File(validatedFilename, publicReadFallbackUrl)
        : await readFallbackStorage?.get(validatedFilename));
    if (!file) {
      return c.json({ error: "File not found" }, 404);
    }

    const headers = buildFileHeaders(
      file.contentType,
      filename,
      overlay.status === "approved",
      c.req.header("Origin"),
    );
    return new Response(file.body, { headers });
  } catch (error) {
    console.error("Error serving file:", error);
    return c.json({ error: "Failed to serve file" }, 500);
  }
});
