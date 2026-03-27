#!/usr/bin/env bash
# Usage:
#   ./filter_combined.sh <source.osm.pbf>             — full run (steps 1+2+3, ~40min)
#   ./filter_combined.sh --rederive <source.osm.pbf>  — skip step 1, re-derive ways+areal from
#                                                        existing *_proposed.osm.pbf (~2min)
#
# Outputs:
#   *_proposed.osm.pbf       — full extract (ways + areas + route relations), used by linear Pass 2
#   *_proposed_ways.osm.pbf  — transport ways only (~73MB), used by linear Pass 1 (locations=True)
#   *_proposed_areal.osm.pbf — building/area ways+relations only, used by areal script

set -e

REDERIVE=0
if [ "$1" = "--rederive" ]; then
    REDERIVE=1
    shift
fi

SOURCE="${1:?Usage: $0 [--rederive] <source.osm.pbf>}"
OUTPUT="${SOURCE/.osm.pbf/_proposed.osm.pbf}"
WAYS_OUTPUT="${SOURCE/.osm.pbf/_proposed_ways.osm.pbf}"
AREAL_OUTPUT="${SOURCE/.osm.pbf/_proposed_areal.osm.pbf}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAY_FILTERS="$SCRIPT_DIR/way_filters.txt"
AREAL_FILTERS="$SCRIPT_DIR/areal_filters.txt"

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

# ---------------------------------------------------------------------------
if [ "$REDERIVE" -eq 1 ]; then
    echo ""
    echo "[$(ts)] STEP 1/3: Skipped (--rederive) — using existing $OUTPUT  ($(filesize "$OUTPUT"))"
    if [ ! -f "$OUTPUT" ]; then
        echo "ERROR: $OUTPUT not found. Run without --rederive first."
        exit 1
    fi
else
    echo ""
    echo "[$(ts)] STEP 1/3: Full filter (ways + areas + route relations)"
    echo "  Input:  $SOURCE  ($(filesize "$SOURCE"))"
    echo "  Output: $OUTPUT"
    echo "  Reading the full planet PBF — expect ~40 minutes, osmium produces no intermediate output."
    echo "----------------------------------------------------------"
    T=$SECONDS

    osmium tags-filter \
        --overwrite \
        -o "$OUTPUT" \
        "$SOURCE" \
        -e "$WAY_FILTERS" \
        -e "$AREAL_FILTERS" \
        r/type=route \
        r/type=site \
        r/type=public_transport

    echo "[$(ts)] STEP 1/3 done in $(elapsed $((SECONDS - T))) — output: $(filesize "$OUTPUT")"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[$(ts)] STEP 2/3: Extracting transport ways only (for fast geometry loading)"
echo "  Input:  $OUTPUT  ($(filesize "$OUTPUT"))"
echo "  Output: $WAYS_OUTPUT"
echo "----------------------------------------------------------"
T=$SECONDS

osmium tags-filter \
    --overwrite \
    -o "$WAYS_OUTPUT" \
    "$OUTPUT" \
    -e "$WAY_FILTERS"

echo "[$(ts)] STEP 2/3 done in $(elapsed $((SECONDS - T))) — output: $(filesize "$WAYS_OUTPUT")"

# ---------------------------------------------------------------------------
echo ""
echo "[$(ts)] STEP 3/3: Extracting building/area features only"
echo "  Input:  $OUTPUT  ($(filesize "$OUTPUT"))"
echo "  Output: $AREAL_OUTPUT"
echo "----------------------------------------------------------"
T=$SECONDS

osmium tags-filter \
    --overwrite \
    -o "$AREAL_OUTPUT" \
    "$OUTPUT" \
    -e "$AREAL_FILTERS"

echo "[$(ts)] STEP 3/3 done in $(elapsed $((SECONDS - T))) — output: $(filesize "$AREAL_OUTPUT")"
