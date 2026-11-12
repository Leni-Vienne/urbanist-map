import { afterEach, describe, expect, mock, spyOn, test, type Mock } from "bun:test";

// SQL.file is stubbed below; no connection is opened.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "tile-cache-test-secret-32-characters";
const [database, tiles] = await Promise.all([import("../database"), import("./tiles")]);

afterEach(() => {
  mock.restore();
  tiles.invalidateTileBounds(null);
});

// Only SQL.file's awaited rows are exercised here, not its streaming/query-control methods.
function mockTileQuery(client: typeof database.tilesSqlClientHighZoom) {
  return spyOn(client, "file") as Mock<
    (filename: string, values?: unknown[]) => Promise<{ tile: Buffer }[]>
  >;
}

async function tileRequest() {
  return await tiles.tilesApp.request("/projects/7/64/64");
}

async function tileText(): Promise<string> {
  const response = await tileRequest();
  return await response.text();
}

describe("tile invalidation", () => {
  test("captured bounds evict a cached tile without looking up an entity", async () => {
    const query = mockTileQuery(database.tilesSqlClientHighZoom)
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
    const query = mockTileQuery(database.tilesSqlClientHighZoom)
      .mockReturnValueOnce(delayed.promise)
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

describe("tile coordinates", () => {
  test.each([
    "7abc/64/64",
    "7/64.5/64",
    "7/64/0x40",
    "23/0/0",
    "7/-1/64",
    "7/128/64",
    "7/64/128",
    "0/1/0",
  ])("rejects %s before querying SQL", async (coordinates) => {
    const failure = new Error("Invalid coordinates must not reach SQL");
    const low = mockTileQuery(database.tilesSqlClientLowZoom).mockRejectedValue(failure);
    const high = mockTileQuery(database.tilesSqlClientHighZoom).mockRejectedValue(failure);
    const response = await tiles.tilesApp.request(`/projects/${coordinates}`);
    expect(response.status).toBe(400);
    expect(low).not.toHaveBeenCalled();
    expect(high).not.toHaveBeenCalled();
  });

  test.each(["0/0/0", "3/7/7", "4/15/15", "7/127/127", "22/4194303/4194303"])(
    "accepts grid boundary %s",
    async (coordinates) => {
      const low = mockTileQuery(database.tilesSqlClientLowZoom).mockResolvedValue([]);
      const high = mockTileQuery(database.tilesSqlClientHighZoom).mockResolvedValue([]);
      const response = await tiles.tilesApp.request(`/projects/${coordinates}`);
      expect(response.status).toBe(204);
      const z = Number(coordinates.split("/")[0]);
      expect(low).toHaveBeenCalledTimes(z >= 4 && z <= 6 ? 1 : 0);
      expect(high).toHaveBeenCalledTimes(z > 6 ? 1 : 0);
    },
  );
});
