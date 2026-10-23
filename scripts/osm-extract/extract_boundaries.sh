#!/usr/bin/env bash
# Usage:
#   ./extract_boundaries.sh [--output-dir <dir>] <source.osm.pbf>
#
# Extracts administrative boundaries (boundary=administrative relations) from an OSM
# PBF and writes them as newline-delimited GeoJSON (one Feature per line), consumed by
# back/src/scripts/import-boundaries.ts.
#
# Output is streamed (geojsonseq) rather than a single FeatureCollection: worldwide
# boundaries are large and the importer reads them line-by-line to bound memory.
# Geometry is full-resolution here; simplification happens in PostGIS on import.
#
# Each feature carries: @id (e.g. "r1403916"), @timestamp (the relation's last-edit time,
# only when the source PBF has metadata), admin_level, name, name:* tags, and ISO3166-1
# codes when present on the relation.
#
# Note: if your source is on a Windows drive (/mnt/...) WSL I/O is slow; copy to the
# WSL filesystem first for better performance.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/osm_log.sh"

trap 'trap - INT TERM; log_warn "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

OUTPUT_DIR_OVERRIDE=""
while [[ "$1" == --* ]]; do
    case "$1" in
        --output-dir) OUTPUT_DIR_OVERRIDE="${2:?--output-dir requires a path}"; shift ;;
        *) log_error "Unknown flag: $1"; exit 1 ;;
    esac
    shift
done

SOURCE="${1:?Usage: $0 [--output-dir <dir>] <source.osm.pbf>}"
if [ ! -f "$SOURCE" ]; then
    log_error "File $SOURCE not found!"
    exit 1
fi

command -v osmium &>/dev/null || { log_error "osmium not found (https://osmcode.org/osmium-tool/)"; exit 1; }

SOURCE_ABS="$(realpath "$SOURCE")"
OUTPUT_DIR="${OUTPUT_DIR_OVERRIDE:-$(dirname "$SOURCE_ABS")}"
BASE="$(basename "${SOURCE%.osm.pbf}")"
BOUNDARIES_PBF="${SOURCE%.osm.pbf}_boundaries.osm.pbf"
BOUNDARIES_GEOJSON="${OUTPUT_DIR}/${BASE}_boundaries.geojsonl"

log_debug "Boundary extraction inputs" "input=$SOURCE" "output=$BOUNDARIES_GEOJSON"

# Phase 1: keep only administrative boundary relations (and the ways/nodes they need).
# Relations are kept with their members so osmium can assemble the area geometry.
# Skipped when an up-to-date filtered file already exists (the filter over a planet is the slow
# part); delete the *_boundaries.osm.pbf to force a refresh.
if [ -f "$BOUNDARIES_PBF" ] && [ "$BOUNDARIES_PBF" -nt "$SOURCE" ]; then
    osm_step_skip filter cached_artifact
else
    osm_step_start filter "input=$SOURCE" "output=$BOUNDARIES_PBF"
    osm_run osmium tags-filter "$SOURCE" \
        r/boundary=administrative \
        --output "$BOUNDARIES_PBF" \
        --overwrite
    osm_step_end
fi

# osmium export emits no OSM object metadata by default; this config adds @timestamp (the
# relation's last-edit time) so the importer can fill external_last_modified. Only "attributes"
# is set, so all tags are still exported (no include/exclude filter). Empty if the source PBF
# carries no metadata.
EXPORT_CONFIG="$(mktemp)"
trap 'rc=$?; rm -f "$EXPORT_CONFIG"; osm_log_exit "$rc"' EXIT
cat > "$EXPORT_CONFIG" <<'EOF'
{ "attributes": { "timestamp": "@timestamp" } }
EOF

# Phase 2: assemble areas and export as a GeoJSON sequence (one Feature per line).
#   --geometry-types=polygon  drop stray points/lines, keep (multi)polygons only
#   --add-unique-id=type_id   emit @id like "r1403916"
#   --config                  add @timestamp (see above)
#   -f geojsonseq             RFC 8142 sequence; each line is prefixed with an RS byte (0x1e),
#                             which the importer strips before parsing.
osm_step_start export "input=$BOUNDARIES_PBF" "output=$BOUNDARIES_GEOJSON"
osm_run osmium export "$BOUNDARIES_PBF" \
    --geometry-types=polygon \
    --add-unique-id=type_id \
    --config "$EXPORT_CONFIG" \
    -f geojsonseq \
    --output "$BOUNDARIES_GEOJSON" \
    --overwrite
osm_step_end
log_info "Wrote boundary GeoJSON sequence" "event=artifact_written" "output=$BOUNDARIES_GEOJSON" \
    "size_bytes=$(wc -c < "$BOUNDARIES_GEOJSON" | tr -d '[:space:]')"
