import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

// SQL.file is stubbed below; no connection is opened.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "tile-cache-test-secret-32-characters";
const [database, tiles] = await Promise.all([import("../database"), import("./tiles")]);

afterEach(() => {
  mock.restore();
  tiles.invalidateTileBounds(null);
});

async function tileRequest() {
  return await tiles.tilesApp.request("/projects/7/64/64");
}

async function tileText(): Promise<string> {
  const response = await tileRequest();
  return await response.text();
}

describe("tile invalidation", () => {
  test("captured bounds evict a cached tile without looking up an entity", async () => {
    const query = spyOn(database.tilesSqlClientHighZoom, "file")
      .mockResolvedValueOnce([{ tile: Buffer.from("old") }])
      .mockResolvedValueOnce([{ tile: Buffer.from("new") }]);
    expect(await tileText()).toBe("old");
    expect(await tileText()).toBe("old");
    expect(query).toHaveBeenCalledTimes(1);
    tiles.invalidateTileBounds([{ minLng: 0, minLat: 0, maxLng: 0.1, maxLat: 0.1 }]);
    expect(await tileText()).toBe("new");
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("an old in-flight result cannot replace a tile generated after invalidation", async () => {
    const delayed = Promise.withResolvers<{ tile: Buffer }[]>();
    const query = spyOn(database.tilesSqlClientHighZoom, "file")
      .mockResolvedValueOnce(delayed.promise)
      .mockResolvedValueOnce([{ tile: Buffer.from("new") }]);
    const oldRequest = tileRequest();
    expect(query).toHaveBeenCalledTimes(1);
    tiles.invalidateTileBounds([{ minLng: 0, minLat: 0, maxLng: 0.1, maxLat: 0.1 }]);
    expect(await tileText()).toBe("new");
    delayed.resolve([{ tile: Buffer.from("old") }]);
    const oldResponse = await oldRequest;
    expect(await oldResponse.text()).toBe("old");
    expect(await tileText()).toBe("new");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
