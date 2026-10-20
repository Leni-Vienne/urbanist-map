import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "@/stores/authStore";
import { uploadImageFile } from "./uploadImageFile";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "user-1",
    email: "test@example.com",
    username: "Test",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
});
afterEach(() => mock.restore());

describe("image upload sequencing", () => {
  test("sends batch images sequentially while sharing a repeated file request", async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const entered = Promise.withResolvers<undefined>();
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        Object.assign(async () => {
          entered.resolve(undefined);
          return firstResponse.promise;
        }, originalFetch),
      )
      .mockResolvedValue(Response.json({ filename: "second.png" }));
    const file = new File(["first"], "first.png");
    const first = uploadImageFile(file);
    const repeated = uploadImageFile(file);
    const second = uploadImageFile(new File(["second"], "second.png"));
    await entered.promise;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    firstResponse.resolve(Response.json({ filename: "first.png" }));
    expect(await Promise.all([first, repeated, second])).toEqual([
      "first.png",
      "first.png",
      "second.png",
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("a failed upload does not block subsequent images", async () => {
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "upload.error.busy" }, { status: 429 }))
      .mockResolvedValue(Response.json({ filename: "second.png" }));
    const first = uploadImageFile(new File(["first"], "first.png")).catch(
      (error: unknown) => error,
    );
    const second = uploadImageFile(new File(["second"], "second.png"));
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBe("second.png");
  });

  test("queued images are not uploaded under a different account", async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const entered = Promise.withResolvers<undefined>();
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => {
        entered.resolve(undefined);
        return firstResponse.promise;
      }, originalFetch),
    );
    const first = uploadImageFile(new File(["first"], "first.png"));
    const queued = uploadImageFile(new File(["private"], "private.png")).catch(
      (error: unknown) => error,
    );
    await entered.promise;
    const auth = useAuthStore();
    if (!auth.user) throw new Error("Test user missing");
    auth.user = { ...auth.user, id: "user-2" };
    firstResponse.resolve(Response.json({ filename: "first.png" }));
    await first;
    expect(await queued).toBeInstanceOf(Error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
