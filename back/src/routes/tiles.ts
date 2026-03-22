import { Hono } from "hono";
import { tilesSqlClient } from "../database"; // client with jit=off for tile generation

export const tilesApp = new Hono();

// GET /api/tiles/projects/:z/:x/:y
// Serves MVT tiles with two layers:
//   - project-shapes: approved project geometry (lines/polygons)
//   - overlay-footprints: approved overlay corners as polygon outlines
tilesApp.get("/projects/:z/:x/:y", async (c) => {
  try {
    const z = Number.parseInt(c.req.param("z"), 10);
    const x = Number.parseInt(c.req.param("x"), 10);
    const y = Number.parseInt(c.req.param("y"), 10);

    if (
      Number.isNaN(z) ||
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      z < 0 ||
      z > 22 ||
      x < 0 ||
      y < 0
    ) {
      return c.json({ error: "Invalid tile coordinates" }, 400);
    }

    // using the jit=off client to avoid LLVM compilation overhead : 2x lower latency, 5x lower CPU load
    const [row] = await tilesSqlClient.file(`${import.meta.dir}/tiles.sql`, [z, x, y]);

    const tileData = row?.tile as Buffer | undefined;

    if (!tileData || tileData.length === 0) {
      // Return empty 204 No Content for empty tiles (standard for MVT)
      return new Response(null, { status: 204 });
    }

    return new Response(new Uint8Array(tileData), {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating MVT tile:", error);
    return Response.json(
      { error: "Failed to generate MVT tile" },
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
