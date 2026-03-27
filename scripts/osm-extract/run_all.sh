#!/usr/bin/env bash
# Usage: ./run_all.sh <source.osm.pbf>
# Runs both linear (transport) and areal (building/development) extractions.
# A single osmium pass filters ways + route relations, then both Python extractions run in parallel.

set -e

trap 'trap - INT TERM; echo "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"

if [ ! -f "$SOURCE" ]; then
    echo "Error: File $SOURCE not found!"
    exit 1
fi

BASE="${SOURCE%.osm.pbf}"
COMBINED_PBF="${BASE}_proposed_combined.osm.pbf"
LINEAR_GEOJSON="${BASE}_proposed_linear.geojson"
AREAL_GEOJSON="${BASE}_proposed_areal.geojson"

function elapsed() {
    local secs=$1
    printf "%dm%02ds" $((secs / 60)) $((secs % 60))
}

echo "=========================================================="
echo " STEP 1/2: Filtering (single pass: ways + route relations, should take 40 minutes)"
echo "=========================================================="
T0=$SECONDS

./filter_combined.sh "$SOURCE"

echo "  -> Done in $(elapsed $((SECONDS - T0)))"

echo ""
echo "=========================================================="
echo " STEP 2/2: Extracting features (linear + areal, should take 3 minutes)"
echo "=========================================================="
T1=$SECONDS

python3 extract_linear_topo.py \
    --ways-file "$COMBINED_PBF" \
    --source-file "$COMBINED_PBF" \
    --output "$LINEAR_GEOJSON" &
PID_LINEAR=$!

python3 extract_areal_buildings.py \
    --source "$COMBINED_PBF" \
    --output "$AREAL_GEOJSON" &
PID_AREAL=$!

echo "  [linear] PID $PID_LINEAR"
echo "  [areal]  PID $PID_AREAL"
echo "  Waiting for both..."

FAILED=0
wait $PID_LINEAR || { echo "  ERROR: linear extraction failed"; FAILED=1; }
wait $PID_AREAL  || { echo "  ERROR: areal extraction failed";  FAILED=1; }

echo "  -> Done in $(elapsed $((SECONDS - T1)))"

echo ""
echo "=========================================================="
echo " TOTAL: $(elapsed $SECONDS)"
echo " Outputs:"
echo "  - $LINEAR_GEOJSON"
echo "  - $AREAL_GEOJSON"
echo "  Intermediate:"
echo "  - $COMBINED_PBF"
echo "=========================================================="

exit $FAILED
