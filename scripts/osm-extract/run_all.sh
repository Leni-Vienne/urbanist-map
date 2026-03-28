#!/usr/bin/env bash
# Usage:
#   ./run_all.sh [--rederive] [--output-dir <dir>] <source.osm.pbf>
#
# Runs both linear (transport) and areal (building/development) extractions.
# A single osmium pass filters ways + route relations, then derives focused files,
# then both Python extractions run in parallel.
#
# --rederive    Skip the ~40min osmium filter, re-derive ways+areal from existing *_proposed.osm.pbf
# --output-dir  Where to write output GeoJSON files (default: same dir as source)
#
# Note: if your source file is on a Windows drive (/mnt/...), processing works but WSL /mnt/ I/O is slow.
# For better performance, copy the file to the WSL filesystem first (stored on C: by default).

set -e

trap 'trap - INT TERM; echo "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

REDERIVE_FLAG=""
OUTPUT_DIR_OVERRIDE=""

while [[ "$1" == --* ]]; do
    case "$1" in
        --rederive)   REDERIVE_FLAG="--rederive" ;;
        --output-dir) OUTPUT_DIR_OVERRIDE="${2:?--output-dir requires a path}"; shift ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
    shift
done

SOURCE="${1:?Usage: $0 [--rederive] [--output-dir <dir>] <source.osm.pbf>}"
if [ ! -f "$SOURCE" ]; then
    echo "Error: File $SOURCE not found!"
    exit 1
fi

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

MISSING=()
command -v osmium  &>/dev/null || MISSING+=("osmium (https://osmcode.org/osmium-tool/)")
command -v python3 &>/dev/null || MISSING+=("python3")

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "Error: missing required dependencies:"
    for dep in "${MISSING[@]}"; do
        echo "  - $dep"
    done
    exit 1
fi

MISSING_PY=()
python3 -c "import osmium"  2>/dev/null || MISSING_PY+=("osmium  (pip install osmium)")
python3 -c "import shapely" 2>/dev/null || MISSING_PY+=("shapely  (pip install shapely)")

if [ ${#MISSING_PY[@]} -gt 0 ]; then
    echo "Error: missing required Python packages:"
    for pkg in "${MISSING_PY[@]}"; do
        echo "  - $pkg"
    done
    exit 1
fi

# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

SOURCE_ABS="$(realpath "$SOURCE")"
OUTPUT_DIR="${OUTPUT_DIR_OVERRIDE:-$(dirname "$SOURCE_ABS")}"

if [[ "$SOURCE_ABS" == /mnt/* ]]; then
    echo ""
    echo "Note: source file is on a Windows drive. Processing in-place — this works but WSL /mnt/ I/O is slow."
    echo "      For better performance, copy the file to the WSL filesystem first (stored on C: by default)."
    echo ""
fi

BASE="${SOURCE%.osm.pbf}"
COMBINED_PBF="${BASE}_proposed.osm.pbf"
WAYS_PBF="${BASE}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE}_proposed_areal.osm.pbf"
LINEAR_GEOJSON="${OUTPUT_DIR}/$(basename "${BASE}")_proposed_linear.geojson"
AREAL_GEOJSON="${OUTPUT_DIR}/$(basename "${BASE}")_proposed_areal.geojson"

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
echo "=========================================================="
T0=$SECONDS

"$SCRIPT_DIR/filter_combined.sh" $REDERIVE_FLAG "$SOURCE"

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

python3 "$SCRIPT_DIR/extract_linear_topo.py" \
    --ways-file "$WAYS_PBF" \
    --source-file "$COMBINED_PBF" \
    --output "$LINEAR_GEOJSON" &
PID_LINEAR=$!

python3 "$SCRIPT_DIR/extract_areal_buildings.py" \
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
