#!/usr/bin/env bash
# Derive the focused sub-PBFs the Python extraction reads from a construction
# subset PBF (<base>_proposed.osm.pbf):
#   *_proposed_ways.osm.pbf      , transport ways (linear Pass 1)
#   *_proposed_areal.osm.pbf     , building/area features (areal)
#   *_proposed_relations.osm.pbf , relations only (linear Pass 2)
#
# All three read the source independently, so they run in parallel. osmium
# tags-filter keeps nodes referenced by matching ways by default, so geometry
# already baked into the source (e.g. by backfill_geometry.sh) flows into the
# sub-PBFs without re-fetching.
#
# update_weekly.sh calls this after the diff catch-up. Run it standalone to rebuild
# the sub-PBFs when iterating on the Python extraction, without re-applying diffs.
#
# Usage:
#   ./derive_subpbfs.sh <base>_proposed.osm.pbf [--dry-run]

set -euo pipefail

DRY_RUN=0
SOURCE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --*)       echo "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$SOURCE" ]]; then echo "Unexpected argument: $1"; exit 1; fi
            SOURCE="$1"
            ;;
    esac
    shift
done

if [[ -z "$SOURCE" ]]; then
    echo "Usage: $0 <base>_proposed.osm.pbf [--dry-run]"
    exit 1
fi
if [[ ! -f "$SOURCE" ]]; then
    echo "Error: source file not found: $SOURCE"
    exit 1
fi
command -v osmium &>/dev/null || { echo "Error: osmium not found"; exit 1; }

SOURCE="$(realpath "$SOURCE")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINEAR_FILTERS="$SCRIPT_DIR/linear_filters.txt"
AREAL_FILTERS="$SCRIPT_DIR/areal_filters.txt"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)

function ts()       { date '+%H:%M:%S'; }
function elapsed()  { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }
function run()      { if [[ "$DRY_RUN" -eq 1 ]]; then echo "[dry-run] $*"; else "$@"; fi; }

BASE_PREFIX="${SOURCE%_proposed.osm.pbf}"
WAYS_PBF="${BASE_PREFIX}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE_PREFIX}_proposed_areal.osm.pbf"
RELATIONS_PBF="${BASE_PREFIX}_proposed_relations.osm.pbf"

echo "[$(ts)] Deriving ways/areal/relations sub-PBFs from $(basename "$SOURCE")"
T=$SECONDS
run osmium tags-filter --overwrite --input-format=pbf,num_threads="$NPROC" \
    -o "$WAYS_PBF" "$SOURCE" -e "$LINEAR_FILTERS" &
PID_WAYS=$!
run osmium tags-filter --overwrite --input-format=pbf,num_threads="$NPROC" \
    -o "$AREAL_PBF" "$SOURCE" -e "$AREAL_FILTERS" &
PID_AREAL=$!
run osmium cat --overwrite --input-format=pbf,num_threads="$NPROC" \
    --object-type=relation -o "$RELATIONS_PBF" "$SOURCE" &
PID_REL=$!
wait $PID_WAYS  || { echo "ERROR: ways derive failed";      exit 1; }
wait $PID_AREAL || { echo "ERROR: areal derive failed";     exit 1; }
wait $PID_REL   || { echo "ERROR: relations derive failed"; exit 1; }

echo "[$(ts)] Derive done in $(elapsed $((SECONDS - T)))"
if [[ "$DRY_RUN" -eq 0 ]]; then
    echo "  $WAYS_PBF      , $(filesize "$WAYS_PBF")"
    echo "  $AREAL_PBF     , $(filesize "$AREAL_PBF")"
    echo "  $RELATIONS_PBF , $(filesize "$RELATIONS_PBF")"
fi
