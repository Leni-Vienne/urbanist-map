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

## Weekly incremental updates

After an initial full run, use `update_weekly.sh` to apply OSM weekly diffs instead of re-filtering the full planet. This cuts the update cycle from ~45min to ~10-15min.

```bash
# Extract + import in one go
./update_weekly.sh --import planet-latest_proposed.osm.pbf

# Extract only (run import manually afterwards)
./update_weekly.sh planet-latest_proposed.osm.pbf

# Preview what would happen
./update_weekly.sh --dry-run planet-latest_proposed.osm.pbf
```

The script reads the `osmosis_replication_timestamp` from the PBF header (set automatically when filtering from an official planet download), binary-searches the daily replication feed at `planet.openstreetmap.org/replication/day/` to find the matching sequence, downloads and chains all daily diffs since that point, then calls `run_all.sh --rederive` on the result.

Note: planet.osm.org publishes weekly full planet dumps (`.osm.bz2`) but OSC change files are only available at daily granularity. Running after 3 weeks of inactivity chains 21 daily diffs (~50-100MB each).

**Recommended cadence**: run `update_weekly.sh` weekly, and do a full `run_all.sh` on a fresh planet download once a month to correct any geometry drift (elements that gained proposed tags for the first time may have incomplete node data in the incremental path).
