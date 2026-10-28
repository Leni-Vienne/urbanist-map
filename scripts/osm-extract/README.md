# OSM Extract Scripts

Extracts proposed/under-construction urban features from an OSM PBF file and outputs two GeoJSON files, one for linear features (transport), one for areal features (buildings, development areas).

## Requirements

Must be run inside WSL (Windows Subsystem for Linux) or a native Linux environment.

**System tools**

- `osmium`, [osmium-tool](https://osmcode.org/osmium-tool/): `sudo apt install osmium-tool`

**Python packages**

- `osmium` >= 4.0, `pip install 'osmium>=4.0'` (native relation-member filtering).
  Optionally, build with the [tag-copy patch](patches/README.md) (patch target:
  4.3.2) for faster extraction. The extractors use `TagList.to_dict()` when
  available and fall back to tag iteration otherwise.
- `shapely`, `pip install shapely`

## Usage

There are two entry points:

- **`run_all.sh`** , one-shot initial bootstrap from a fresh planet/region download. Filters
  the planet to the construction subset, then hands off to `update_daily.sh` to catch
  up to today, extract, and (optionally) import. Use it the first time or to rebuild
  from scratch.
- **`update_daily.sh`** , the routine refresh. Applies the daily diffs since the last
  run, backfills geometry, derives the sub-PBFs, extracts the GeoJSON, and imports. Run
  it on a schedule (see `scripts/systemd/osm-update.service`).

Extraction lives only in `update_daily.sh`, downstream of the diff catch-up. A raw
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

| Flag       | Description                                                               |
| ---------- | ------------------------------------------------------------------------- |
| `--import` | Run the DB import after extraction (passed through to `update_daily.sh`). |

## Outputs

Both files are written next to the PBF:

| File                        | Contents                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `*_proposed_linear.geojson` | Railways, roads, aerialways, waterways, cycling/pedestrian paths tagged as proposed, planned or under construction |
| `*_proposed_areal.geojson`  | Buildings and development areas tagged as proposed, planned or under construction                                  |

`--import` passes the generated file prefix to the importer. For a manual worldwide
import, run `bun run osm:import` from the repository root; no filenames are needed.
The importer defaults to `scripts/osm-extract/planet-latest_proposed_{linear,areal}.geojson`
relative to the repository, even when invoked directly from another directory.
For worldwide files stored elsewhere, use
`bun run osm:import --input-prefix /data/planet-latest_proposed`.
Both GeoJSON files are required before the importer starts updating the database.
The importer syncs the single `osm_world` source and prunes absent projects, so a
regional extract must not be imported into the worldwide database.

## Linear grouping policy

Orphan ways (ways not assigned to an accepted OSM relation) use four passes:

1. Join ways that share snapped endpoints.
2. Join explicit matching names within 100 m, references within 1 km, or Wikidata
   IDs within 10 km. Descriptions and inferred display names are not identities.
3. Group unidentified rail fragments within 10 m with bearings within 15 degrees.
4. Group unidentified non-rail fragments within 200 m.

Every pass requires the same transport type and lifecycle status. Conflicting
names, references, or Wikidata IDs block a merge across the entire group, so an
unidentified intermediate way cannot join incompatible projects. Localized names
and lifecycle references also count as identities. Ways with descriptions are
not treated as unidentified. Proximity alone never attaches an unidentified
fragment to an identified project.

Distance checks compare the actual lines, using a local planar approximation
that adjusts longitude for latitude. Bounding boxes only find candidates. Limits
apply to each connection; a chain of connected fragments can span farther.

## Area selection policy

Lifecycle land-use tags share a whitelist of development and recreation types,
defined in [osm_policy.py](osm_policy.py), alongside Python eligibility,
category, lifecycle, and size-gate rules for both extractors.
Generic `yes` values remain subject to size/identity checks and existing exclusions.
Unsupported future uses such as `grass` and `brownfield` do not qualify on their
own, even with a name or generic lifecycle flag; another supported project tag can.

Current use is separate: `landuse=brownfield` with `planned:landuse=residential`
qualifies as residential redevelopment. Unspecified future uses do not inherit the
current site's category.

The areal extractor writes accepted features as they arrive, without retaining a
collection of shapes, properties, or coordinates. It preserves callback order,
including repeated IDs. Output is staged beside the destination and replaces it
only after successful extraction and file closure; failures leave the previous
GeoJSON available. This temporarily needs space for both old and new GeoJSON.

## Performance note

If the source file is on a Windows drive (`/mnt/d/...`), the script works but WSL I/O through `/mnt/` is significantly slower than on the WSL native filesystem. For large files (country-level or planet), copying the source to the WSL filesystem first (`cp /mnt/d/... ~/`) can cut processing time substantially. WSL is installed on C: by default.

## Stages

| Stage              | Script                                  | Duration (planet) |
| ------------------ | --------------------------------------- | ----------------- |
| filter             | `filter_combined.sh` (via `run_all.sh`) | ~30-40 min        |
| catch-up + extract | `update_daily.sh`                       | ~25-30 min        |

`filter_combined.sh` only produces the construction subset PBF; deriving the sub-PBFs
and running `extract_linear_topo.py` + `extract_areal_buildings.py` happens inside
`update_daily.sh`, after the diff catch-up.

The sub-PBF derivation lives in `derive_subpbfs.sh`, which `update_daily.sh` calls.
Run it standalone to rebuild `*_proposed_ways`/`*_proposed_areal`/`*_proposed_relations`
from the subset PBF without re-applying diffs, e.g. when iterating on the Python
extraction (geometry backfilled into the subset PBF flows through automatically):

```bash
./derive_subpbfs.sh planet-latest_proposed.osm.pbf
```

## Daily incremental updates

`update_daily.sh` applies OSM daily diffs to an existing subset PBF instead of rebuilding from a planet download. A normal one-diff run currently takes roughly 25-30 minutes including extraction and import; a catch-up run takes longer.

The updater requires 9 GiB of free working space, a fixed budget for our worldwide
subset rather than a calculation for regional extracts. Long catch-up runs can
need additional space for downloaded diffs.

```bash
# Extract + import in one go
./update_daily.sh --import planet-latest_proposed.osm.pbf

# Extract only (run import manually afterwards)
./update_daily.sh planet-latest_proposed.osm.pbf

# Skip the geometry backfill (re-tagged elements may be dropped)
./update_daily.sh --no-backfill planet-latest_proposed.osm.pbf

# Preview what would happen
./update_daily.sh --dry-run planet-latest_proposed.osm.pbf
```

The script reads the last applied sequence from the `*.replication-state` sidecar (falling back to the PBF header on a fresh filter), resolves the current daily sequence from `planet.openstreetmap.org/replication/day/`, downloads and chains all daily diffs since that point, then derives the sub-PBFs and runs the extraction on the result.

### Geometry backfill

A daily diff carries an element's full tags and references, but not the
referenced nodes/members whose own data did not change. When a pre-existing OSM
element is re-tagged to construction, those nodes/members were never in the
filtered PBF, so the element lands with dangling references and the Python
extraction silently drops it (it keeps only nodes with a valid location).

`update_daily.sh` runs `backfill_geometry.sh` after the re-derive to fix this:
`osmium check-refs` lists the missing node/way/relation IDs, they are fetched by
ID from the Overpass API (ways and relations with full member recursion), and
`osmium merge` folds the geometry back in. It iterates until `check-refs` is
clean. The step is best-effort: any network or merge failure is a warning and
never aborts the daily run (the fallback is the same incomplete geometry as
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
The main-PBF merge is a full rewrite of the multi-GB file and dominates the
backfill step; it is the price of persisting the geometry so future runs do not
have to fetch it again.

`backfill_geometry.sh` takes one or more merge targets and optional `--detect`
sources (defaulting to the first target). A target that does not exist yet is
created from the fetched geometry:

```bash
# Standalone on a focused sub-PBF
./backfill_geometry.sh planet-latest_proposed_ways.osm.pbf

# Detect against sub-PBFs, merge into them and the main PBF (what update_daily does)
./backfill_geometry.sh \
    planet-latest_proposed_ways.osm.pbf \
    planet-latest_proposed_areal.osm.pbf \
    planet-latest_proposed.osm.pbf \
    --detect planet-latest_proposed_ways.osm.pbf \
    --detect planet-latest_proposed_areal.osm.pbf

# Report missing refs only, no network or writes
./backfill_geometry.sh --dry-run planet-latest_proposed_ways.osm.pbf
```

## Logging and monitoring

Bash entry points use `osm_log.sh`; Python extractors use the standard `logging`
module through `osm_log.py`. Diagnostics are flushed to stderr as logfmt records
with UTC timestamps, severity, component, and a shared run ID. Stdout remains
available for machine output. The TypeScript importer emits one JSON event per
line with the same run ID, numeric statistics, and structured errors. Native tool
output is forwarded as-is; backfill failures retain up to 4096 bytes of captured
diagnostics.

Timed phases emit `event=step_completed`, a stable `step`, and numeric
`duration_seconds`. Measured Bash phases and Python phases use a monotonic clock.
Bash commands run through the standard-library `osm_resources.py` helper; private
temporary records are combined into the existing completion event, then removed.
There is no sampling loop or periodic resource log stream. Python is needed for
Bash resource fields; without it Bash keeps reporting elapsed whole seconds. Exceptions and nonzero shell
exits produce structured error events; dry-run records carry `dry_run=1` and are
excluded from dashboard timings. Backfill remains best-effort and reports
unresolved geometry as a warning with remaining node/way/relation counts.

`OSM_LOG_LEVEL` controls both Bash and Python logging: `DEBUG`, `INFO` (default),
`WARNING`, or `ERROR`. DEBUG includes individual fetch batches and merge strategy
details. INFO includes phase timings, numeric feature counts and file sizes, and
replication sequences. Feature samples are not logged. WARNING/ERROR levels hide
successful timing events, so keep INFO for normal Grafana monitoring.

The final shell event carries `status=success`, `partial`, `unchanged`, `failed`,
or `dry_run`. Skipped phases emit `step_skipped` with a reason and no duration.
Standalone backfill exits 0 when complete, 2 when partial, and 1 on failure.
`update_daily.sh` handles both nonzero backfill outcomes, continues with available
geometry, and records `status=partial` on completion. A later fatal failure takes
precedence. Partial daily runs still exit zero so systemd can restart the backend.
`run_all.sh` hands off to the daily updater for the final outcome.

`osmium tags-filter` re-reads its input to discover referenced objects: two
passes for the linear/ways filter and four for the areal and combined filters.
That pass count, not the thread count, dominates the osmium phases. PBF parsing
uses libosmium's thread pool (`OSMIUM_POOL_THREADS`, default `nproc-2`); there is
no `num_threads` input-format option, and unknown format options are silently
ignored.

For optimization, each measured pipeline phase reports:

- `cpu_seconds`: CPU time in measured commands, including waited descendants.
- `avg_cpu_percent`: CPU seconds / elapsed seconds × 100. 100% means one CPU core;
  multiple busy cores can exceed 100%. Low use can indicate waiting for disk,
  network, locks, or CPU scheduling; it is not proof of an I/O bottleneck.
- `max_process_rss_bytes`: the largest individual process peak resident memory.
  Parallel worker peaks are not added, and this is not total simultaneous RAM.

Python substeps additionally report their own CPU delta, current
`rss_start_bytes` / `rss_end_bytes` on Linux, and `process_peak_rss_bytes`.
That last value is the high-water mark since the Python process started, not
an isolated substep peak. Compare start/end RSS to locate retained memory growth.
The helper requires no additional packages, exporter, or systemd configuration.
Only instrumented local commands are covered: PostgreSQL and Docker services
running outside the updater's process tree are excluded. Failed phase summaries
may contain only the resource records that were collected before interruption.

The areal extractor reports a combined `extract` phase because its reading,
geometry processing, and writing are interleaved; its `total` phase remains the
whole-process comparison with the linear extractor.

The systemd unit captures stderr in the journal, and the existing Alloy source
forwards those records to Loki. See [the OSM dashboard guide](../../docs/GRAFANA_OSM.md)
for setup, the bottom-to-top step stack order, and query limitations.

Run the extraction and logging tests with the Python dependencies installed:

```bash
python3 -m unittest discover -s scripts/osm-extract -p 'test_*.py'
```
