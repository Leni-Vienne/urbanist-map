import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { readPublicR2File, R2StorageS3 } from "./storage";

const storage = new R2StorageS3({
  endpoint: "https://example.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucketName: "test-bucket",
});
const filename = "thumbnails/example.webp";
const fetchSpy = spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
});

afterAll(() => {
  fetchSpy.mockRestore();
});

describe("R2StorageS3.get", () => {
  test("streams an existing image with its stored content type", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("image bytes", { headers: { "Content-Type": "image/webp" } }),
    );

    const result = await storage.get(filename);
    expect(result?.contentType).toBe("image/webp");
    expect(await new Response(result?.body).text()).toBe("image bytes");
  });

  test("returns null for a missing object", async () => {
    const response = new Response("NoSuchKey", { status: 404 });
    fetchSpy.mockResolvedValueOnce(response);

    expect(await storage.get(filename)).toBeNull();
    expect(response.bodyUsed).toBe(true);
  });

  test.each([403, 500, 503])(
    "propagates HTTP %i instead of returning not found",
    async (status) => {
      const response = new Response("storage error", { status });
      fetchSpy.mockResolvedValueOnce(response);

      const failure = await storage.get(filename).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toHaveProperty("message", expect.stringContaining(`HTTP ${status}`));
      expect(response.bodyUsed).toBe(true);
    },
  );

  test("propagates network failures instead of returning not found", async () => {
    const networkError = new Error("Network unavailable");
    fetchSpy.mockRejectedValueOnce(networkError);

    expect(await storage.get(filename).catch((error: unknown) => error)).toBe(networkError);
  });
});

describe("readPublicR2File", () => {
  test("reads the thumbnail from the public base URL without an S3 signature", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("public image", { headers: { "Content-Type": "image/webp" } }),
    );

    const result = await readPublicR2File(filename, "https://cdn.example.com/images/");
    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example.com/images/thumbnails/example.webp");
    expect(result?.contentType).toBe("image/webp");
    expect(await new Response(result?.body).text()).toBe("public image");
  });

  test("returns null when the public image is absent", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not found", { status: 404 }));

    expect(await readPublicR2File(filename, "https://cdn.example.com")).toBeNull();
  });
});
