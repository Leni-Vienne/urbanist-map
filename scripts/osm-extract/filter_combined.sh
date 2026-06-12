#!/usr/bin/env bash
# Usage:
#   ./filter_combined.sh <source.osm.pbf>            , full run (steps 1+2+3+4)
#   ./filter_combined.sh --rederive <source.osm.pbf> , skip step 1, re-derive ways+areal+relations
#                                                        from existing *_proposed.osm.pbf (~2min)
#
# Outputs:
#   *_proposed.osm.pbf          , full extract (ways + areas + route relations)
#   *_proposed_ways.osm.pbf     , transport ways only (~73MB), used by linear Pass 1 (locations=True)
#   *_proposed_areal.osm.pbf    , building/area ways+relations only, used by areal script
#   *_proposed_relations.osm.pbf, relations only, used by linear Pass 2
#
# Speed notes:
#   Step 1 uses all CPU cores for PBF decompression and lz4 for intermediate output.
#   Steps 2, 3 and 4 run in parallel since they read the same input independently.

set -e

REDERIVE=0
if [ "$1" = "--rederive" ]; then
    REDERIVE=1
    shift
fi

SOURCE="${1:?Usage: $0 [--rederive] <source.osm.pbf>}"
if [ "$REDERIVE" -eq 0 ] && [ ! -f "$SOURCE" ]; then
    echo "Error: source file not found: $SOURCE"
    exit 1
fi
OUTPUT="${SOURCE/.osm.pbf/_proposed.osm.pbf}"
WAYS_OUTPUT="${SOURCE/.osm.pbf/_proposed_ways.osm.pbf}"
AREAL_OUTPUT="${SOURCE/.osm.pbf/_proposed_areal.osm.pbf}"
RELATIONS_OUTPUT="${SOURCE/.osm.pbf/_proposed_relations.osm.pbf}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINEAR_FILTERS="$SCRIPT_DIR/linear_filters.txt"
AREAL_FILTERS="$SCRIPT_DIR/areal_filters.txt"

NPROC=$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

# ---------------------------------------------------------------------------
if [ "$REDERIVE" -eq 1 ]; then
    echo ""
    echo "[$(ts)] STEP 1/4: Skipped (--rederive), using existing $OUTPUT  ($(filesize "$OUTPUT"))"
    if [ ! -f "$OUTPUT" ]; then
        echo "ERROR: $OUTPUT not found. Run without --rederive first."
        exit 1
    fi
else
    echo ""
    echo "[$(ts)] STEP 1/4: Full filter (ways + areas + route relations)"
    echo "  Input:  $SOURCE  ($(filesize "$SOURCE"))"
    echo "  Output: $OUTPUT"
    echo "  Threads: $NPROC  |  Output compression: lz4"
    echo "  Reading the full planet PBF, osmium produces no intermediate output."
    echo "----------------------------------------------------------"
    T=$SECONDS

    COMBINED_FILTERS="$(dirname "$OUTPUT")/.osmium_filters_$$.txt"
    trap 'rm -f "$COMBINED_FILTERS"' EXIT
    "$SCRIPT_DIR/build_combined_filters.sh" > "$COMBINED_FILTERS"

    osmium tags-filter \
        --overwrite \
        --input-format=pbf,num_threads="$NPROC" \
        --output-format=pbf,pbf_compression=lz4 \
        -o "$OUTPUT" \
        "$SOURCE" \
        -e "$COMBINED_FILTERS"

    rm -f "$COMBINED_FILTERS"
    trap - EXIT
    echo "[$(ts)] STEP 1/4 done in $(elapsed $((SECONDS - T))), output: $(filesize "$OUTPUT")"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[$(ts)] STEP 2+3+4: Extracting ways, areal features and relations in parallel"
echo "  Input:  $OUTPUT  ($(filesize "$OUTPUT"))"
echo "----------------------------------------------------------"
T=$SECONDS

osmium tags-filter \
    --overwrite \
    --input-format=pbf,num_threads="$NPROC" \
    -o "$WAYS_OUTPUT" \
    "$OUTPUT" \
    -e "$LINEAR_FILTERS" &
PID_WAYS=$!

osmium tags-filter \
    --overwrite \
    --input-format=pbf,num_threads="$NPROC" \
    -o "$AREAL_OUTPUT" \
    "$OUTPUT" \
    -e "$AREAL_FILTERS" &
PID_AREAL=$!

# Relations-only file for linear Pass 2: RelationHandler never reads member
# geometries, so it doesn't need the nodes/ways that dominate $OUTPUT.
osmium cat \
    --overwrite \
    --input-format=pbf,num_threads="$NPROC" \
    --object-type=relation \
    -o "$RELATIONS_OUTPUT" \
    "$OUTPUT" &
PID_RELATIONS=$!

wait $PID_WAYS      || { echo "ERROR: ways filter failed"; exit 1; }
wait $PID_AREAL     || { echo "ERROR: areal filter failed"; exit 1; }
wait $PID_RELATIONS || { echo "ERROR: relations extract failed"; exit 1; }

echo "[$(ts)] STEP 2+3+4 done in $(elapsed $((SECONDS - T)))"
echo "  $WAYS_OUTPUT      , $(filesize "$WAYS_OUTPUT")"
echo "  $AREAL_OUTPUT     , $(filesize "$AREAL_OUTPUT")"
echo "  $RELATIONS_OUTPUT , $(filesize "$RELATIONS_OUTPUT")"
