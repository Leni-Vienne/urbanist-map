import { Hono } from "hono";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import { eq } from "drizzle-orm";
import { LocalFileStorage, getThumbnailFilename, compressImageIfNeeded } from "../lib/storage";
import { exceedsPendingStorageQuota } from "../lib/storageQuota";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { allowedDomains } from "../lib/corsConfig";
import type { FileUploadResult, AppEnv, SessionUser } from "../lib/types";
import * as rateLimit from "../lib/rateLimit";
import { getClientIp } from "../utils/ip";
import { logger } from "../services/logger";
import { db } from "../database";
import { overlays, projects } from "../db/schema";

export const uploadsApp = new Hono<AppEnv>();

// Always use local storage for initial uploads - images migrate to R2 on approval
const storage = new LocalFileStorage();

const filenameParamSchema = z.object({
  filename: z
    .string()
    .min(1, "Filename is required")
    .regex(/^[a-zA-Z0-9\-_./]+$/, "Invalid filename format")
    .refine((name) => !name.includes(".."), "Path traversal not allowed"),
});

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      allowedDomains.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

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
): Record<string, string> {
  const headers: Record<string, string> = {
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
  };

  if (process.env.NODE_ENV === "development") {
    headers["Access-Control-Allow-Origin"] = origin ?? "*";
    headers["Access-Control-Allow-Credentials"] = "true";
  } else if (isAllowedCorsOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin ?? "";
    headers["Access-Control-Allow-Credentials"] = "true";
  } else {
    headers["Access-Control-Allow-Origin"] = allowedDomains[0]
      ? `https://${allowedDomains[0]}`
      : "";
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
uploadsApp.post("/api/upload-image", async (c) => {
  try {
    // Rate limit: 10 uploads per IP per minute
    const ip = getClientIp(c);
    if (!rateLimit.check(ip, 10, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    // Require authentication
    // Uploads are only allowed for logged-in users to prevent anonymous spam
    const session = c.get("session");
    const user = session.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

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

    // Extract file extension for filename generation
    const lastDot = file.name.lastIndexOf(".");
    const fileExtension =
      lastDot !== -1 && lastDot !== file.name.length - 1
        ? file.name.slice(lastDot + 1).toLowerCase()
        : null;

    // Ensure we have a valid extension (this should not fail due to Zod validation)
    if (!fileExtension) {
      logger.warn({ fileName: file.name }, "Upload failed: Invalid file extension");
      return c.json({ error: "Invalid file extension" }, 400);
    }

    const originalBuffer = await file.arrayBuffer();

    // Smart compression: convert to WebP at quality 90, but keep original if it's smaller
    // This prevents double-compression artifacts on already-optimized images
    const compressionResult = await compressImageIfNeeded(originalBuffer, fileExtension);

    // Both the compressed file and the uncapped original land in local storage until moderation,
    // so weigh both against the user's pending quota before writing anything to disk.
    const incomingBytes = compressionResult.finalSize + originalBuffer.byteLength;
    if (await exceedsPendingStorageQuota(user.id, incomingBytes)) {
      return c.json({ error: "upload.error.storageQuotaExceeded" }, 413);
    }

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).slice(2, 15);
    const filename = `${timestamp}-${randomString}.${compressionResult.extension}`;

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

    // Save to local storage - images are not uploaded to R2 until moderator approval
    // LocalFileStorage.put also automatically generates 120x120 thumbnail
    await storage.put(filename, compressionResult.buffer);

    // Keep the pre-compression original locally (never migrated to R2) so approved
    // content retains a full-quality, uncapped source. Removed on rejection/deletion.
    const originalFilename = `${timestamp}-${randomString}.${fileExtension}`;
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
  }
});

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
      const user = c.get("session").get("user");
      if (!user) {
        return c.json({ error: "Authentication required" }, 401);
      }
      if (!isAuthorizedForOverlay(user, overlay)) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    const file = await storage.get(validatedFilename);
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
