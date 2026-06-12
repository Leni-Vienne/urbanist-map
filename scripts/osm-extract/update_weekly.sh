#!/usr/bin/env bash
# Weekly incremental update for the proposed/construction OSM extract.
#
# Instead of re-filtering the full planet PBF (~40min), this script:
#   1. Determines the replication sequence number from the existing filtered PBF
#   2. Downloads matching daily OSC diffs from planet.osm.org/replication/day/
#   3. Applies each diff in sequence to the filtered PBF via osmium apply-changes
#   4. Re-derives the ways/areal sub-PBFs (--rederive, ~2min)
#   5. Runs the Python feature extraction (~3-5min)
#   6. Runs the DB import (import-osm.ts)
#
# Note: planet.osm.org publishes weekly full planet dumps (.osm.bz2) but OSC
# change files are only available at daily (and finer) granularity. Running
# this script after 3 weeks of inactivity will download and chain 21 daily
# diffs (~50-100MB each, ~1.5GB total), still much less than re-downloading
# the planet.
#
# Total expected time per week of catchup: ~5min (~10-15min for a typical run).
#
# LIMITATION: elements that gain proposed/construction tags for the first time
# (i.e., pre-existing OSM ways that get re-tagged) may have incomplete geometry
# because their nodes were not in the filtered PBF. A monthly full re-filter
# (run_all.sh on a fresh planet.osm.pbf) is recommended to correct any drift.
#
# Usage:
#   ./update_weekly.sh <planet_proposed.osm.pbf> [--import] [--dry-run]
#
# Options:
#   --import    Run import-osm.ts after extraction (requires bun + backend)
#   --dry-run   Print what would be done without executing

set -euo pipefail

trap 'trap - INT TERM; echo "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

DO_IMPORT=0
DRY_RUN=0
FILTERED_PBF=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --import)   DO_IMPORT=1 ;;
        --dry-run)  DRY_RUN=1 ;;
        --*)        echo "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$FILTERED_PBF" ]]; then
                echo "Unexpected argument: $1"
                exit 1
            fi
            FILTERED_PBF="$1"
            ;;
    esac
    shift
done

if [[ -z "$FILTERED_PBF" ]]; then
    echo "Usage: $0 <planet_proposed.osm.pbf> [--import] [--dry-run]"
    echo ""
    echo "  <planet_proposed.osm.pbf>  The filtered PBF produced by run_all.sh"
    echo "                             (the file ending in _proposed.osm.pbf)"
    echo "  --import                   Run import-osm.ts after extraction"
    echo "  --dry-run                  Print what would be done, do not execute"
    exit 1
fi

if [[ ! -f "$FILTERED_PBF" ]]; then
    echo "Error: file not found: $FILTERED_PBF"
    exit 1
fi

FILTERED_PBF="$(realpath "$FILTERED_PBF")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

MISSING=()
command -v osmium  &>/dev/null || MISSING+=("osmium (https://osmcode.org/osmium-tool/)")
command -v curl    &>/dev/null || MISSING+=("curl")
command -v python3 &>/dev/null || MISSING+=("python3")

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "Error: missing required dependencies:"
    for dep in "${MISSING[@]}"; do echo "  - $dep"; done
    exit 1
fi

MISSING_PY=()
python3 -c "import osmium"  2>/dev/null || MISSING_PY+=("osmium  (pip install osmium)")
python3 -c "import shapely" 2>/dev/null || MISSING_PY+=("shapely  (pip install shapely)")

if [[ ${#MISSING_PY[@]} -gt 0 ]]; then
    echo "Error: missing required Python packages:"
    for pkg in "${MISSING_PY[@]}"; do echo "  - $pkg"; done
    exit 1
fi

if [[ "$DO_IMPORT" -eq 1 ]]; then
    command -v bun &>/dev/null || { echo "Error: bun not found (required for --import)"; exit 1; }
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function ts()      { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

function run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] $*"
    else
        "$@"
    fi
}

# ---------------------------------------------------------------------------
# Step 1: Read replication timestamp
#
# Priority order:
#   1. Sidecar state file <pbf>.replication-state  (written by this script after each run;
#      most authoritative, tracks the last successfully applied sequence)
#   2. REPL_TIMESTAMP env var (bootstrap for the very first run when no sidecar exists)
#   3. osmosis_replication_timestamp header in the PBF (present on fresh planet downloads,
#      lost after osmium apply-changes)
# ---------------------------------------------------------------------------

echo ""
echo "=========================================================="
echo "[$(ts)] STEP 1: Reading replication timestamp"
echo "=========================================================="

STATE_FILE="${FILTERED_PBF}.replication-state"

if [[ -f "$STATE_FILE" ]]; then
    # Sidecar file written by a previous run of this script: sequenceNumber=NNN\ntimestamp=...
    REPL_TIMESTAMP=$(grep "^timestamp="      "$STATE_FILE" | cut -d= -f2 | tr -d '[:space:]' || true)
    LAST_SEQNUM=$(   grep "^sequenceNumber=" "$STATE_FILE" | cut -d= -f2 | tr -d '[:space:]' || true)
    echo "  Source: sidecar state file ($STATE_FILE)"
    echo "  timestamp:      $REPL_TIMESTAMP"
    echo "  sequenceNumber: ${LAST_SEQNUM:-(not found)}"
elif [[ -n "${REPL_TIMESTAMP:-}" ]]; then
    echo "  Source: REPL_TIMESTAMP env var"
    echo "  timestamp: $REPL_TIMESTAMP"
else
    # Fall back to the PBF header (present on fresh planet downloads)
    # osmium fileinfo (without -e) reads only PBF headers. The -e flag would
    # scan every object in the file, which on a multi-GB planet is ~2min wasted.
    FILEINFO=$(osmium fileinfo "$FILTERED_PBF" 2>/dev/null)
    REPL_TIMESTAMP=$(echo "$FILEINFO" | grep -i "osmosis_replication_timestamp" | sed 's/.*= *//' | tr -d '[:space:]' || true)
    echo "  Source: PBF header"
    echo "  osmosis_replication_timestamp: ${REPL_TIMESTAMP:-(not found)}"
fi

if [[ -z "$REPL_TIMESTAMP" ]]; then
    echo ""
    echo "ERROR: Could not determine replication timestamp."
    echo "On the first run after a fresh planet filter this is read from the PBF header."
    echo "On subsequent runs it is read from the sidecar file: $STATE_FILE"
    echo ""
    echo "If the sidecar file is missing, pass the timestamp manually:"
    echo "  REPL_TIMESTAMP=2026-03-16T01:00:01Z ./update_weekly.sh ..."
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Resolve the OSC sequence number from the timestamp
#
# planet.osm.org daily replication lives at:
#   https://planet.openstreetmap.org/replication/day/
# Each sequence directory contains a .osc.gz diff and a .state.txt file.
# We binary-search the sequence numbers to find where our PBF timestamp lands.
# ---------------------------------------------------------------------------

echo ""
echo "=========================================================="
echo "[$(ts)] STEP 2: Resolving OSC sequence number for $REPL_TIMESTAMP"
echo "=========================================================="

REPL_BASE_URL="https://planet.openstreetmap.org/replication/day"

# Fetch the current (latest) state to know the maximum sequence number
CURRENT_STATE=$(curl -sfL "${REPL_BASE_URL}/state.txt") || true
if [[ -z "$CURRENT_STATE" ]]; then
    echo "ERROR: Failed to fetch current replication state from ${REPL_BASE_URL}/state.txt"
    echo "Check network access or verify the URL is reachable."
    exit 1
fi
CURRENT_SEQNUM=$(echo "$CURRENT_STATE" | grep "^sequenceNumber=" | cut -d= -f2 | tr -d '[:space:]' || true)
CURRENT_TS=$(echo "$CURRENT_STATE"     | grep "^timestamp="      | cut -d= -f2 | tr -d '[:space:]' || true)
if [[ -z "$CURRENT_SEQNUM" ]]; then
    echo "ERROR: Could not parse sequenceNumber from state.txt. Got:"
    echo "$CURRENT_STATE"
    exit 1
fi

echo "  Current replication sequence: $CURRENT_SEQNUM  ($CURRENT_TS)"

# Binary-search helper: given a sequence number, fetch its timestamp from state.txt
function fetch_seq_timestamp() {
    local seq=$1
    # Sequence numbers are zero-padded to 9 digits, split into 3 groups of 3
    local padded
    padded=$(printf "%09d" "$seq")
    local p1="${padded:0:3}"
    local p2="${padded:3:3}"
    local p3="${padded:6:3}"
    local url="${REPL_BASE_URL}/${p1}/${p2}/${p3}.state.txt"
    curl -sfL "$url" 2>/dev/null | grep "^timestamp=" | cut -d= -f2 | tr -d '[:space:]' || true
}

# Convert an ISO-8601 timestamp to epoch seconds (portable: works with GNU date or BSD date)
function ts_to_epoch() {
    # OSM state.txt timestamps use backslash-escaped colons: 2025-03-31T00\:00\:00Z
    local ts="${1//\\/}"
    date -d "$ts" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null || echo 0
}

PBF_EPOCH=$(ts_to_epoch "$REPL_TIMESTAMP")
if [[ "$PBF_EPOCH" -eq 0 ]]; then
    echo "ERROR: Could not parse timestamp: $REPL_TIMESTAMP"
    exit 1
fi

echo "  PBF timestamp epoch: $PBF_EPOCH"

# If the sidecar recorded the last applied sequence number, start from the next one directly.
# Otherwise binary-search to find the last sequence whose timestamp <= PBF timestamp,
# then start from seq+1 (OSM state timestamps represent the state *after* that sequence,
# so starting at that sequence would re-apply already-included changes).
if [[ -n "${LAST_SEQNUM:-}" ]]; then
    FOUND_SEQ="$LAST_SEQNUM"
    FOUND_TS=$(fetch_seq_timestamp "$FOUND_SEQ")
    echo "  Resuming from sidecar sequence: $FOUND_SEQ  ($FOUND_TS)"
else
    echo "  Binary-searching for matching sequence number..."

    LO=1
    HI="$CURRENT_SEQNUM"
    FOUND_SEQ=""

    while [[ "$LO" -le "$HI" ]]; do
        MID=$(( (LO + HI) / 2 ))
        MID_TS=$(fetch_seq_timestamp "$MID")
        if [[ -z "$MID_TS" ]]; then
            # Sequence might not exist yet, move left
            HI=$(( MID - 1 ))
            continue
        fi
        MID_EPOCH=$(ts_to_epoch "$MID_TS") || true
        # Find the last sequence whose timestamp <= PBF timestamp
        if [[ "$MID_EPOCH" -le "$PBF_EPOCH" ]]; then
            FOUND_SEQ="$MID"
            LO=$(( MID + 1 ))
        else
            HI=$(( MID - 1 ))
        fi
    done

    if [[ -z "$FOUND_SEQ" ]]; then
        echo "ERROR: Could not find a replication sequence <= PBF timestamp."
        echo "The PBF may be older than the oldest available daily diff."
        exit 1
    fi

    FOUND_TS=$(fetch_seq_timestamp "$FOUND_SEQ")
    echo "  Matched sequence: $FOUND_SEQ  ($FOUND_TS)"
fi

START_SEQ=$(( FOUND_SEQ + 1 ))
echo "  Will apply sequences $START_SEQ through $CURRENT_SEQNUM  ($((CURRENT_SEQNUM - START_SEQ + 1)) diffs)"

# Nothing to do: PBF is already at the latest published sequence.
# But verify that extraction artifacts from the previous run are intact (an OOM
# in step 4 can leave the ways PBF empty while the sidecar is already advanced).
# In that case fall through and re-run step 4 without re-applying any diffs.
if [[ "$START_SEQ" -gt "$CURRENT_SEQNUM" ]]; then
    _WAYS_PBF_CHECK="${FILTERED_PBF%_proposed.osm.pbf}_proposed_ways.osm.pbf"
    _RELATIONS_PBF_CHECK="${FILTERED_PBF%_proposed.osm.pbf}_proposed_relations.osm.pbf"
    if [[ -s "$_WAYS_PBF_CHECK" && -s "$_RELATIONS_PBF_CHECK" ]]; then
        echo ""
        echo "[$(ts)] Already up to date (sequence $CURRENT_SEQNUM). Nothing to apply."
        exit 0
    fi
    echo ""
    echo "[$(ts)] Sequence is current ($CURRENT_SEQNUM) but ways or relations PBF is missing or empty."
    echo "         A previous step 4 likely failed (e.g. OOM). Skipping diff application and re-running extraction."
fi

# ---------------------------------------------------------------------------
# Step 3: Download and apply OSC diffs
#
# All OSCs in the sequence range are downloaded first, then applied to the
# filtered PBF in a single osmium apply-changes call. Batching avoids a full
# re-read + re-write of the multi-GB PBF for each daily diff on catch-up runs.
# OSCs must be passed in chronological order; the seq-ordered list below is.
#
# Cancellation safety: $FILTERED_PBF is not modified in this step. Output goes
# to a separate _updated.osm.pbf, and the sidecar is only written on success,
# so an interrupted run is safe to re-invoke (stale files are cleared below).
# ---------------------------------------------------------------------------

echo ""
echo "=========================================================="
echo "[$(ts)] STEP 3: Downloading and applying OSC diffs"
echo "=========================================================="

WORK_DIR="$(dirname "$FILTERED_PBF")"
FINAL_PBF="${FILTERED_PBF%.osm.pbf}_updated.osm.pbf"

# Clear intermediates from any previously-interrupted run.
# _seq*.osm.pbf covers files left behind by older per-sequence versions of this script.
if [[ "$DRY_RUN" -eq 0 ]]; then
    rm -f "${WORK_DIR}/daily_diff_"*.osc.gz
    rm -f "${FILTERED_PBF%.osm.pbf}_seq"*.osm.pbf
    rm -f "${FILTERED_PBF%.osm.pbf}_refiltered.osm.pbf"
    rm -f "$FINAL_PBF"
fi

# Phase 1: download every OSC in range.
OSC_FILES=()
TOTAL_DIFFS=$(( CURRENT_SEQNUM - START_SEQ + 1 ))
for SEQ in $(seq "$START_SEQ" "$CURRENT_SEQNUM"); do
    PADDED=$(printf "%09d" "$SEQ")
    P1="${PADDED:0:3}"
    P2="${PADDED:3:3}"
    P3="${PADDED:6:3}"
    OSC_URL="${REPL_BASE_URL}/${P1}/${P2}/${P3}.osc.gz"
    OSC_FILE="${WORK_DIR}/daily_diff_${PADDED}.osc.gz"

    echo "[$(ts)] Downloading sequence $SEQ / $CURRENT_SEQNUM"
    echo "  $OSC_URL"
    run curl -sfL -o "$OSC_FILE" "$OSC_URL" || {
        echo "ERROR: Failed to download $OSC_URL"
        exit 1
    }
    if [[ "$DRY_RUN" -eq 0 ]]; then
        echo "  Downloaded: $(filesize "$OSC_FILE")"
    fi
    OSC_FILES+=("$OSC_FILE")
done

# Phase 2: apply all diffs in one osmium call.
# Skipped when falling through from the "already up to date but extraction
# incomplete" path (no new diffs exist, so there is nothing to merge).
if [[ ${#OSC_FILES[@]} -gt 0 ]]; then
    echo ""
    echo "[$(ts)] Applying $TOTAL_DIFFS diff(s) to $FILTERED_PBF"
    echo "  Output: $FINAL_PBF"
    run osmium apply-changes \
        --overwrite \
        --output-format=pbf,pbf_compression=lz4 \
        -o "$FINAL_PBF" \
        "$FILTERED_PBF" \
        "${OSC_FILES[@]}"

    # apply-changes merges every changed object from the diffs, filtered or not.
    # Re-filter (same rules as filter_combined.sh step 1) so the PBF only keeps
    # matching objects and does not grow with unrelated planet data on every run.
    echo ""
    echo "[$(ts)] Re-filtering merged PBF to drop non-matching diff objects"
    REFILTER_RULES="${WORK_DIR}/.osmium_filters_$$.txt"
    "$SCRIPT_DIR/build_combined_filters.sh" > "$REFILTER_RULES"
    REFILTERED_PBF="${FILTERED_PBF%.osm.pbf}_refiltered.osm.pbf"
    run osmium tags-filter \
        --overwrite \
        --output-format=pbf,pbf_compression=lz4 \
        -o "$REFILTERED_PBF" \
        "$FINAL_PBF" \
        -e "$REFILTER_RULES"
    rm -f "$REFILTER_RULES"
    run mv -f "$REFILTERED_PBF" "$FINAL_PBF"

    # Phase 3: clean up the OSCs now that they're baked into $FINAL_PBF.
    if [[ "$DRY_RUN" -eq 0 ]]; then
        rm -f "${OSC_FILES[@]}"
        echo ""
        echo "[$(ts)] Final updated PBF: $FINAL_PBF  ($(filesize "$FINAL_PBF"))"
    fi

    # Write sidecar state file so the next run knows where to resume.
    # osmium apply-changes does not preserve the replication header, so we track
    # the sequence number and its timestamp ourselves.
    FINAL_SEQ_TS=$(fetch_seq_timestamp "$CURRENT_SEQNUM")
    if [[ "$DRY_RUN" -eq 0 ]]; then
        printf "sequenceNumber=%s\ntimestamp=%s\n" "$CURRENT_SEQNUM" "$FINAL_SEQ_TS" > "$STATE_FILE"
        echo "[$(ts)] Saved replication state to $STATE_FILE (seq=$CURRENT_SEQNUM, ts=$FINAL_SEQ_TS)"
    else
        echo "[dry-run] write $STATE_FILE: sequenceNumber=$CURRENT_SEQNUM timestamp=$FINAL_SEQ_TS"
    fi
else
    echo "[$(ts)] No new diffs to apply, re-running extraction from existing PBF."
fi

# ---------------------------------------------------------------------------
# Step 4: Re-derive ways/areal sub-PBFs and run Python extraction
#
# We cannot call run_all.sh here because it expects the *original* source
# (e.g., planet-latest.osm.pbf) and appends _proposed to derive intermediate
# file names -- passing planet-latest_proposed.osm.pbf would produce
# planet-latest_proposed_proposed.osm.pbf. Instead we call filter_combined.sh
# and the Python scripts directly with explicitly computed paths.
# ---------------------------------------------------------------------------

echo ""
echo "=========================================================="
echo "[$(ts)] STEP 4: Re-deriving ways/areal + Python extraction"
echo "=========================================================="

# Swap the updated PBF into place. Atomic rename on the same filesystem,
# so readers see the old or new file but never a half-written one.
# Skipped when no diffs were applied (FINAL_PBF was never created).
if [[ ${#OSC_FILES[@]} -gt 0 ]]; then
    if [[ "$DRY_RUN" -eq 0 ]]; then
        mv -f "$FINAL_PBF" "$FILTERED_PBF"
    else
        echo "[dry-run] mv $FINAL_PBF $FILTERED_PBF"
    fi
fi

# Derive paths the same way run_all.sh would, given the original source name.
# FILTERED_PBF = /path/to/planet-latest_proposed.osm.pbf
# BASE_PREFIX  = /path/to/planet-latest   (strip _proposed.osm.pbf)
BASE_PREFIX="${FILTERED_PBF%_proposed.osm.pbf}"
OUTPUT_DIR="$(dirname "$FILTERED_PBF")"
WAYS_PBF="${BASE_PREFIX}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE_PREFIX}_proposed_areal.osm.pbf"
RELATIONS_PBF="${BASE_PREFIX}_proposed_relations.osm.pbf"
LINEAR_GEOJSON="${OUTPUT_DIR}/$(basename "$BASE_PREFIX")_proposed_linear.geojson"
AREAL_GEOJSON="${OUTPUT_DIR}/$(basename "$BASE_PREFIX")_proposed_areal.geojson"

# filter_combined.sh --rederive skips the slow osmium filter and only runs
# steps 2+3 (split into ways PBF and areal PBF). It derives OUTPUT as
# ${SOURCE/.osm.pbf/_proposed.osm.pbf}, so we pass the original base name.
# filter_combined.sh does not read the source file itself in --rederive mode,
# it only needs it to compute the OUTPUT path.
BASE_SOURCE="${BASE_PREFIX}.osm.pbf"
run "$SCRIPT_DIR/filter_combined.sh" --rederive "$BASE_SOURCE"

echo ""
echo "[$(ts)] Running Python extraction (linear + areal in parallel)"
run python3 "$SCRIPT_DIR/extract_linear_topo.py" \
    --ways-file "$WAYS_PBF" \
    --source-file "$RELATIONS_PBF" \
    --output "$LINEAR_GEOJSON" &
PID_LINEAR=$!

run python3 "$SCRIPT_DIR/extract_areal_buildings.py" \
    --source "$AREAL_PBF" \
    --output "$AREAL_GEOJSON" &
PID_AREAL=$!

wait $PID_LINEAR || { echo "ERROR: linear extraction failed"; exit 1; }
wait $PID_AREAL  || { echo "ERROR: areal extraction failed";  exit 1; }

# ---------------------------------------------------------------------------
# Step 5: DB import (optional)
# ---------------------------------------------------------------------------

if [[ "$DO_IMPORT" -eq 1 ]]; then
    echo ""
    echo "=========================================================="
    echo "[$(ts)] STEP 5: Running import-osm.ts"
    echo "=========================================================="
    run bun run "$REPO_ROOT/back/src/scripts/import-osm.ts"
else
    echo ""
    echo "[$(ts)] Skipping DB import (pass --import to enable)."
    echo "  Run manually: bun run back/src/scripts/import-osm.ts"
fi

echo ""
echo "=========================================================="
echo "[$(ts)] ALL DONE"
echo "=========================================================="
