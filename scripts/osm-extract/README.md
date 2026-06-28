# OSM Extract Scripts

Extracts proposed/under-construction urban features from an OSM PBF file and outputs two GeoJSON files, one for linear features (transport), one for areal features (buildings, development areas).

## Requirements

Must be run inside WSL (Windows Subsystem for Linux) or a native Linux environment.

**System tools**

- `osmium`, [osmium-tool](https://osmcode.org/osmium-tool/): `sudo apt install osmium-tool`

**Python packages**

- `osmium`, `pip install osmium`
- `shapely`, `pip install shapely`

## Usage

There are two entry points:

- **`run_all.sh`** , one-shot bootstrap from a fresh planet/region download. Filters
  the planet to the construction subset, then hands off to `update_weekly.sh` to catch
  up to today, extract, and (optionally) import. Use it the first time or to rebuild
  from scratch.
- **`update_weekly.sh`** , the routine refresh. Applies the daily diffs since the last
  run, backfills geometry, derives the sub-PBFs, extracts the GeoJSON, and imports. Run
  it on a schedule (see `scripts/systemd/osm-update.service`).

Extraction lives only in `update_weekly.sh`, downstream of the diff catch-up. A raw
planet download lags real time by up to ~10 days, so filtering and immediately
extracting would publish stale data; keeping extraction behind the catch-up makes that
impossible.

The source file can be a country or planet extract from [Geofabrik](https://download.geofabrik.de/) or [planet.osm.org](https://planet.osm.org/).

```bash
# Bootstrap from a fresh planet download (filter + catch up + extract + import)
./run_all.sh --import /mnt/d/osm/planet-latest.osm.pbf

# Bootstrap a country extract, no import
./run_all.sh /mnt/d/osm/france-latest.osm.pbf
```

**`run_all.sh` options**

| Flag       | Description                                                                |
| ---------- | -------------------------------------------------------------------------- |
| `--import` | Run the DB import after extraction (passed through to `update_weekly.sh`). |

## Outputs

Both files are written next to the PBF:

| File                        | Contents                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `*_proposed_linear.geojson` | Railways, roads, aerialways, waterways, cycling/pedestrian paths tagged as proposed, planned or under construction |
| `*_proposed_areal.geojson`  | Buildings and development areas tagged as proposed, planned or under construction                                  |

## Performance note

If the source file is on a Windows drive (`/mnt/d/...`), the script works but WSL I/O through `/mnt/` is significantly slower than on the WSL native filesystem. For large files (country-level or planet), copying the source to the WSL filesystem first (`cp /mnt/d/... ~/`) can cut processing time substantially. WSL is installed on C: by default.

## Stages

| Stage              | Script                                  | Duration (planet) |
| ------------------ | --------------------------------------- | ----------------- |
| filter             | `filter_combined.sh` (via `run_all.sh`) | ~30-40 min        |
| catch-up + extract | `update_weekly.sh`                      | ~10-15 min        |

`filter_combined.sh` only produces the construction subset PBF; deriving the sub-PBFs
and running `extract_linear_topo.py` + `extract_areal_buildings.py` happens inside
`update_weekly.sh`, after the diff catch-up.

The sub-PBF derivation lives in `derive_subpbfs.sh`, which `update_weekly.sh` calls.
Run it standalone to rebuild `*_proposed_ways`/`*_proposed_areal`/`*_proposed_relations`
from the subset PBF without re-applying diffs, e.g. when iterating on the Python
extraction (geometry backfilled into the subset PBF flows through automatically):

```bash
./derive_subpbfs.sh planet-latest_proposed.osm.pbf
```

## Weekly incremental updates

`update_weekly.sh` applies OSM daily diffs to an existing subset PBF instead of re-filtering the full planet. This turns a ~30-40 min full re-filter into a ~10-15 min incremental run.

```bash
# Extract + import in one go
./update_weekly.sh --import planet-latest_proposed.osm.pbf

# Extract only (run import manually afterwards)
./update_weekly.sh planet-latest_proposed.osm.pbf

# Skip the geometry backfill (re-tagged elements may be dropped)
./update_weekly.sh --no-backfill planet-latest_proposed.osm.pbf

# Preview what would happen
./update_weekly.sh --dry-run planet-latest_proposed.osm.pbf
```

The script reads the `osmosis_replication_timestamp` from the PBF header (set automatically when filtering from an official planet download), binary-searches the daily replication feed at `planet.openstreetmap.org/replication/day/` to find the matching sequence, downloads and chains all daily diffs since that point, then derives the sub-PBFs and runs the extraction on the result.

Note: planet.osm.org publishes weekly full planet dumps (`.osm.bz2`) but OSC change files are only available at daily granularity. Running after 3 weeks of inactivity chains 21 daily diffs (~50-100MB each).

### Geometry backfill

A daily diff carries an element's full tags and references, but not the
referenced nodes/members whose own data did not change. When a pre-existing OSM
element is re-tagged to construction, those nodes/members were never in the
filtered PBF, so the element lands with dangling references and the Python
extraction silently drops it (it keeps only nodes with a valid location).

`update_weekly.sh` runs `backfill_geometry.sh` after the re-derive to fix this:
`osmium check-refs` lists the missing node/way/relation IDs, they are fetched by
ID from the Overpass API (ways and relations with full member recursion), and
`osmium merge` folds the geometry back in. It iterates until `check-refs` is
clean. The step is best-effort: any network or merge failure is a warning and
never aborts the weekly run (the fallback is the same incomplete geometry as
before). Pass `--no-backfill` to skip it.

Detection (`--detect`) is pointed at the focused sub-PBFs (`*_proposed_ways` and
`*_proposed_areal`), not the main `*_proposed.osm.pbf`. The main PBF also carries
`type=route` / `public_transport` relation members (ordinary roads) whose
geometry the extraction never renders but whose nodes get shed across the
apply-changes / re-filter cycle; scanning it would report hundreds of thousands
of irrelevant dangling refs and trigger a huge, pointless Overpass download.

The fetched geometry is merged into both the sub-PBFs (so the current run's Python
extraction sees it) and the main `*_proposed.osm.pbf` (so it persists). The next
re-derive keeps objects referenced by matching ways, so the baked-in nodes flow
back into the freshly rebuilt sub-PBFs and detection only finds the new delta.
Merging into the multi-GB main PBF is a streaming, page-cached osmium merge that
costs a couple of seconds, the same as the sub-PBFs. A full `run_all.sh` re-filter
overwrites the main PBF from a fresh planet that already carries complete geometry,
so no stale state accumulates.

`backfill_geometry.sh` takes one or more merge targets and optional `--detect`
sources (defaulting to the first target). A target that does not exist yet is
created from the fetched geometry:

```bash
# Standalone on a focused sub-PBF
./backfill_geometry.sh planet-latest_proposed_ways.osm.pbf

# Detect against sub-PBFs, merge into them and the main PBF (what update_weekly does)
./backfill_geometry.sh \
    planet-latest_proposed_ways.osm.pbf \
    planet-latest_proposed_areal.osm.pbf \
    planet-latest_proposed.osm.pbf \
    --detect planet-latest_proposed_ways.osm.pbf \
    --detect planet-latest_proposed_areal.osm.pbf

# Report missing refs only, no network or writes
./backfill_geometry.sh --dry-run planet-latest_proposed_ways.osm.pbf
```

**Recommended cadence**: run `update_weekly.sh` weekly. A full `run_all.sh` on a
fresh planet download once a month is still worthwhile to correct any larger
drift (e.g. references the backfill could not resolve because they were deleted
upstream).
