# OSM Extract Scripts

Extracts proposed/under-construction urban features from an OSM PBF file and outputs two GeoJSON files — one for linear features (transport), one for areal features (buildings, development areas).

## Requirements

Must be run inside WSL (Windows Subsystem for Linux) or a native Linux environment.

**System tools**

- `osmium` — [osmium-tool](https://osmcode.org/osmium-tool/): `sudo apt install osmium-tool`

**Python packages**

- `osmium` — `pip install osmium`
- `shapely` — `pip install shapely`

## Usage

```bash
./run_all.sh [--rederive] [--output-dir <dir>] <source.osm.pbf>
```

The source file can be a country or planet extract from [Geofabrik](https://download.geofabrik.de/) or [planet.osm.org](https://planet.osm.org/).

**Options**

| Flag                 | Description                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--rederive`         | Skip the slow osmium filter step (~40min) and re-derive from an existing `*_proposed.osm.pbf`. Useful when iterating on the Python extraction logic. |
| `--output-dir <dir>` | Where to write the output GeoJSON files. Defaults to the same directory as the source file.                                                          |

**Examples**

```bash
# Full run on a country extract
./run_all.sh /mnt/d/osm/france-latest.osm.pbf

# Full run, outputs to a specific directory
./run_all.sh --output-dir /mnt/d/osm/out /mnt/d/osm/france-latest.osm.pbf

# Re-run only the Python extraction (osmium already done)
./run_all.sh --rederive /mnt/d/osm/france-latest.osm.pbf
```

## Outputs

Both files are written next to the source (or to `--output-dir`):

| File                        | Contents                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `*_proposed_linear.geojson` | Railways, roads, aerialways, waterways, cycling/pedestrian paths tagged as proposed, planned or under construction |
| `*_proposed_areal.geojson`  | Buildings and development areas tagged as proposed, planned or under construction                                  |

## Performance note

If the source file is on a Windows drive (`/mnt/d/...`), the script works but WSL I/O through `/mnt/` is significantly slower than on the WSL native filesystem. For large files (country-level or planet), copying the source to the WSL filesystem first (`cp /mnt/d/... ~/`) can cut processing time substantially. WSL is installed on C: by default.

## Phases

| Phase                  | Tool                                                               | Duration (planet) |
| ---------------------- | ------------------------------------------------------------------ | ----------------- |
| 1 — osmium filter      | `filter_combined.sh`                                               | ~40 min           |
| 2 — feature extraction | `extract_linear_topo.py` + `extract_areal_buildings.py` (parallel) | ~3-5 min          |
