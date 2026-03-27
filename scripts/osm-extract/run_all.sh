#!/usr/bin/env bash
# Usage: ./run_all.sh <source.osm.pbf>
# Runs both linear (transport) and areal (building/development) extractions.
# A single osmium pass filters ways + route relations, then derives focused files,
# then both Python extractions run in parallel.

set -e

trap 'trap - INT TERM; echo "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"

if [ ! -f "$SOURCE" ]; then
    echo "Error: File $SOURCE not found!"
    exit 1
fi

BASE="${SOURCE%.osm.pbf}"
COMBINED_PBF="${BASE}_proposed.osm.pbf"
WAYS_PBF="${BASE}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE}_proposed_areal.osm.pbf"
LINEAR_GEOJSON="${BASE}_proposed_linear.geojson"
AREAL_GEOJSON="${BASE}_proposed_areal.geojson"

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

T_TOTAL=$SECONDS

echo "=========================================================="
echo "[$(ts)] SOURCE:  $SOURCE  ($(filesize "$SOURCE"))"
echo "[$(ts)] OUTPUTS: $LINEAR_GEOJSON"
echo "                 $AREAL_GEOJSON"
echo "=========================================================="

# ---------------------------------------------------------------------------
echo ""
echo "=========================================================="
echo "[$(ts)] PHASE 1: Filtering OSM data"
echo "  takes around 55 minutes for the planet-latest.osm.pbf (89 GB)"
echo "=========================================================="
T0=$SECONDS

./filter_combined.sh "$SOURCE"

echo ""
echo "[$(ts)] PHASE 1 done in $(elapsed $((SECONDS - T0)))"
echo "  $COMBINED_PBF  — $(filesize "$COMBINED_PBF")"
echo "  $WAYS_PBF      — $(filesize "$WAYS_PBF")"
echo "  $AREAL_PBF     — $(filesize "$AREAL_PBF")"

# ---------------------------------------------------------------------------
echo ""
echo "=========================================================="
echo "[$(ts)] PHASE 2: Extracting features (linear + areal in parallel)"
echo "  Expected duration: ~3-5 minutes"
echo "=========================================================="
T1=$SECONDS

python3 extract_linear_topo.py \
    --ways-file "$WAYS_PBF" \
    --source-file "$COMBINED_PBF" \
    --output "$LINEAR_GEOJSON" &
PID_LINEAR=$!

python3 extract_areal_buildings.py \
    --source "$AREAL_PBF" \
    --output "$AREAL_GEOJSON" &
PID_AREAL=$!

echo "[$(ts)] linear PID $PID_LINEAR | areal PID $PID_AREAL"
echo "[$(ts)] Waiting for both to finish..."
echo ""

FAILED=0
wait $PID_LINEAR || { echo "[$(ts)] ERROR: linear extraction failed (PID $PID_LINEAR)"; FAILED=1; }
wait $PID_AREAL  || { echo "[$(ts)] ERROR: areal extraction failed  (PID $PID_AREAL)";  FAILED=1; }

echo ""
echo "[$(ts)] PHASE 2 done in $(elapsed $((SECONDS - T1)))"
echo "  $LINEAR_GEOJSON  — $(filesize "$LINEAR_GEOJSON")"
echo "  $AREAL_GEOJSON   — $(filesize "$AREAL_GEOJSON")"

# ---------------------------------------------------------------------------
echo ""
echo "=========================================================="
echo "[$(ts)] ALL DONE — total: $(elapsed $((SECONDS - T_TOTAL)))"
echo "=========================================================="

exit $FAILED
