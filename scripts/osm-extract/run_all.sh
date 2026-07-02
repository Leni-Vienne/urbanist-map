#!/usr/bin/env bash
# Bootstrap the full dataset from a fresh planet/region PBF.
#
# Usage:
#   ./run_all.sh [--import] <source.osm.pbf>
#
# Two stages, and no extraction of its own:
#   1. filter_combined.sh , reduce the planet to the construction subset (~30-40 min
#                           on a planet). The output is geometry-complete but only as
#                           fresh as the source snapshot (a planet download lags real
#                           time by up to ~10 days).
#   2. update_daily.sh   , apply the daily diffs since that snapshot, backfill the
#                           stripped geometry, derive the sub-PBFs, and extract the
#                           GeoJSON once on current data (and import with --import).
#
# Extraction lives only behind the catch-up in stage 2, so it is structurally
# impossible to publish GeoJSON from the stale snapshot.

set -e

trap 'trap - INT TERM; echo "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

IMPORT_FLAG=""
SOURCE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --import) IMPORT_FLAG="--import" ;;
        --*)      echo "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$SOURCE" ]]; then echo "Unexpected argument: $1"; exit 1; fi
            SOURCE="$1"
            ;;
    esac
    shift
done

if [[ -z "$SOURCE" ]]; then
    echo "Usage: $0 [--import] <source.osm.pbf>"
    exit 1
fi
if [[ ! -f "$SOURCE" ]]; then
    echo "Error: File $SOURCE not found!"
    exit 1
fi

# Fail before the expensive filter rather than after it if --import cannot run.
if [[ -n "$IMPORT_FLAG" ]]; then
    command -v bun &>/dev/null || { echo "Error: bun not found (required for --import)"; exit 1; }
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }

SOURCE_ABS="$(realpath "$SOURCE")"
COMBINED_PBF="${SOURCE_ABS/.osm.pbf/_proposed.osm.pbf}"

if [[ "$SOURCE_ABS" == /mnt/* ]]; then
    echo ""
    echo "Note: source file is on a Windows drive. Processing works but WSL /mnt/ I/O is slow."
    echo "      For better performance, copy the file to the WSL filesystem first (stored on C: by default)."
    echo ""
fi

T_TOTAL=$SECONDS

echo "=========================================================="
echo "[$(ts)] BOOTSTRAP from $SOURCE"
echo "=========================================================="

# Stage 1: reduce the planet to the construction subset.
echo ""
echo "=========================================================="
echo "[$(ts)] STAGE 1/2: Filtering planet to construction subset"
echo "=========================================================="
"$SCRIPT_DIR/filter_combined.sh" "$SOURCE_ABS"

# A fresh filter carries the planet's replication timestamp in its PBF header, but a
# replication-state sidecar from an earlier dataset now points at a stale sequence.
# Drop it so update_daily.sh bootstraps its replication position from the header.
STATE_FILE="${COMBINED_PBF}.replication-state"
if [[ -f "$STATE_FILE" ]]; then
    rm -f "$STATE_FILE"
    echo "[$(ts)] Removed stale replication-state sidecar: $STATE_FILE"
fi

# Stage 2: advance to today, backfill, derive, extract (and optionally import).
echo ""
echo "=========================================================="
echo "[$(ts)] STAGE 2/2: Catch-up + extraction via update_daily.sh"
echo "=========================================================="
"$SCRIPT_DIR/update_daily.sh" "$COMBINED_PBF" $IMPORT_FLAG

echo ""
echo "=========================================================="
echo "[$(ts)] ALL DONE, total: $(elapsed $((SECONDS - T_TOTAL)))"
echo "=========================================================="
