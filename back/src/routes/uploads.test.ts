import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { SessionUser } from "../lib/types";
import { MAX_UPLOAD_FILE_SIZE_BYTES } from "@shared/uploadLimits";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "uploads-test-secret-at-least-32-characters";
const [database, users, quota, storage, limits, { uploadsApp }] = await Promise.all([
  import("../database"),
  import("../lib/currentUser"),
  import("../lib/storageQuota"),
  import("../lib/storage"),
  import("../lib/rateLimit"),
  import("./uploads"),
]);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const user: SessionUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "test@example.com",
  username: "Test",
  role: null,
  moderatedCountries: [],
  emailVerified: true,
};

async function upload(bytes: Uint8Array = png, name = "image.png") {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(bytes)], name, { type: "image/png" }));
  return uploadsApp.request("/api/upload-image", {
    method: "POST",
    body: form,
    headers: { "CF-Connecting-IP": "192.0.2.1" },
  });
}

beforeEach(() => {
  spyOn(users, "resolveSessionUser").mockResolvedValue(user);
  spyOn(limits, "check").mockReturnValue(true);
  spyOn(quota, "exceedsPendingStorageQuota").mockResolvedValue(false);
  spyOn(storage, "compressImageIfNeeded").mockResolvedValue({
    buffer: new Uint8Array(png).buffer,
    extension: "png",
    wasCompressed: false,
    originalSize: png.length,
    finalSize: png.length,
  });
  spyOn(storage, "generateThumbnail").mockResolvedValue(new ArrayBuffer(123));
  spyOn(storage.LocalFileStorage.prototype, "put").mockResolvedValue(undefined);
  spyOn(storage.LocalFileStorage.prototype, "putOriginal").mockResolvedValue(undefined);
  spyOn(console, "error").mockImplementation(() => undefined);
  const proxy = drizzle(async () => ({ rows: [] }));
  // Build inserts normally, executing only against the proxy.
  spyOn(database.db, "insert").mockImplementation(proxy.insert.bind(proxy));
});
afterEach(() => mock.restore());

describe("image upload limits", () => {
  test("rejects a full account before compression or disk writes", async () => {
    spyOn(quota, "exceedsPendingStorageQuota").mockResolvedValue(true);
    const response = await upload();
    expect(response.status).toBe(413);
    expect(storage.compressImageIfNeeded).not.toHaveBeenCalled();
    expect(spyOn(storage.LocalFileStorage.prototype, "put")).not.toHaveBeenCalled();
  });

  test("accounts for the original, processed image and actual thumbnail size", async () => {
    const response = await upload();
    expect(response.status).toBe(200);
    expect(quota.exceedsPendingStorageQuota).toHaveBeenLastCalledWith(
      user.id,
      2 * png.length + 123,
    );
  });

  test("a filename cannot create nested paths that escape original-file cleanup", async () => {
    const response = await upload(png, "image.png/nested-file");
    expect(response.status).toBe(200);
    const written = spyOn(storage.LocalFileStorage.prototype, "putOriginal").mock.calls[0]?.[0];
    expect(written).toMatch(/^\d+-[a-z0-9]+\.png$/);
  });

  test("overlapping uploads cannot race the quota and a failure releases the slot", async () => {
    const pending = Promise.withResolvers<boolean>();
    const entered = Promise.withResolvers<undefined>();
    spyOn(quota, "exceedsPendingStorageQuota").mockImplementationOnce(async () => {
      entered.resolve(undefined);
      return pending.promise;
    });
    const first = upload();
    await entered.promise;
    try {
      const overlapping = await upload();
      expect(overlapping.status).toBe(429);
    } finally {
      pending.reject(new Error("Quota unavailable"));
      const failed = await first;
      expect(failed.status).toBe(500);
    }
    const recovered = await upload();
    expect(recovered.status).toBe(200);
  });

  test("rejects a tiny file declaring an excessive canvas before compression", async () => {
    const excessive = Buffer.from(png);
    excessive.writeUInt32BE(9000, 16);
    excessive.writeUInt32BE(9000, 20);
    const response = await upload(excessive);
    expect(response.status).toBe(400);
    expect(storage.compressImageIfNeeded).not.toHaveBeenCalled();
  });

  test("caps streamed request bodies even without Content-Length", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD_FILE_SIZE_BYTES + 64 * 1024 + 1));
        controller.close();
      },
    });
    const response = await uploadsApp.request("/api/upload-image", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "CF-Connecting-IP": "192.0.2.1",
      },
    });
    expect(response.status).toBe(413);
    expect(storage.compressImageIfNeeded).not.toHaveBeenCalled();
  });
});
