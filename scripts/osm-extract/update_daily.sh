#!/usr/bin/env bash
# Daily incremental update for the proposed/construction OSM extract.
#
# Instead of rebuilding from a planet PBF (~30-40 min), this script:
#   1. Determines the replication sequence number from the existing filtered PBF
#   2. Downloads matching daily OSC diffs from planet.osm.org/replication/day/
#   3. Applies each diff in sequence to the filtered PBF via osmium apply-changes
#   4. Derives the ways/areal/relations sub-PBFs from the result (~2min)
#   5. Runs the Python feature extraction (~3-5min)
#   6. Runs the DB import (import-osm.ts)
#
# Note: planet.osm.org publishes full planet dumps only periodically, but OSC
# change files are available at daily (and finer) granularity. Running
# this script after 3 weeks of inactivity will download and chain 21 daily
# diffs (~50-100MB each, ~1.5GB total), still much less than re-downloading
# the planet.
#
# Total expected time: ~25-30 min for a normal one-diff run (including
# extraction and import), longer for catch-up runs.
#
# Elements that gain proposed/construction tags for the first time (i.e.,
# pre-existing OSM ways/relations that get re-tagged) arrive in the diff with
# their tags but not their unchanged nodes/members, which were never in the
# filtered PBF. backfill_geometry.sh resolves those dangling references from the
# OSM/Overpass API after the diffs are applied. This is the only repair path for
# missing geometry, so a backfill failure is a real failure, not something to
# defer.
#
# Usage:
#   ./update_daily.sh <planet_proposed.osm.pbf> [--import] [--no-backfill] [--dry-run] [--trim]
#
# Options:
#   --import       Run import-osm.ts after extraction (requires bun + backend)
#   --no-backfill  Skip the geometry backfill step (re-tagged elements may be dropped)
#   --dry-run      Print what would be done without executing
#   --trim         Trim the destination filesystem before large PBF writes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/osm_log.sh"
source "$SCRIPT_DIR/osm_disk.sh"

trap 'trap - INT TERM; log_warn "Interrupted, killing child processes..."; kill 0; exit 1' INT TERM

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

DO_IMPORT=0
DO_BACKFILL=1
DRY_RUN=0
FILTERED_PBF=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --import)      DO_IMPORT=1 ;;
        --no-backfill) DO_BACKFILL=0 ;;
        --trim)        OSM_TRIM_BEFORE_WRITE=1 ;;
        --dry-run)     DRY_RUN=1 ;;
        --*)        log_error "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$FILTERED_PBF" ]]; then
                log_error "Unexpected argument: $1"
                exit 1
            fi
            FILTERED_PBF="$1"
            ;;
    esac
    shift
done

if [[ -z "$FILTERED_PBF" ]]; then
    log_error "Usage: $0 <planet_proposed.osm.pbf> [--import] [--no-backfill] [--dry-run] [--trim]"
    log_info "  <planet_proposed.osm.pbf>  The filtered PBF produced by run_all.sh"
    log_info "                             (the file ending in _proposed.osm.pbf)"
    log_info "  --import                   Run import-osm.ts after extraction"
    log_info "  --no-backfill              Skip geometry backfill for re-tagged elements"
    log_info "  --dry-run                  Print what would be done, do not execute"
    log_info "  --trim                     Trim before large PBF writes (disabled by default)"
    exit 1
fi

# The update deletes the original PBF once diffs are merged into
# <base>_updated.osm.pbf, keeping peak disk at two copies. If a run died between
# that delete and the final swap, the original is gone but the merged file
# remains: promote it back. Its diffs are re-applied and re-filtered this run
# (the replication state only advances on success), so the result is correct.
RECOVER_MERGED="${FILTERED_PBF%.osm.pbf}_updated.osm.pbf"
if [[ ! -f "$FILTERED_PBF" && -f "$RECOVER_MERGED" ]]; then
    log_warn "$FILTERED_PBF missing, recovering merged file from interrupted run: $RECOVER_MERGED"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[dry-run] mv $RECOVER_MERGED $FILTERED_PBF"
    else
        mv -f "$RECOVER_MERGED" "$FILTERED_PBF"
    fi
fi

if [[ ! -f "$FILTERED_PBF" ]]; then
    log_error "file not found: $FILTERED_PBF"
    exit 1
fi

FILTERED_PBF="$(realpath "$FILTERED_PBF")"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$(dirname "$FILTERED_PBF")"
FINAL_PBF="${FILTERED_PBF%.osm.pbf}_updated.osm.pbf"

# All derived artifact names strip the _proposed.osm.pbf suffix. Guard it once
# here so a mismatched input fails loudly instead of a silent no-op strip
# producing paths like foo.osm.pbf_proposed_ways.osm.pbf.
if [[ "$FILTERED_PBF" != *_proposed.osm.pbf ]]; then
    log_error "expected a *_proposed.osm.pbf file (produced by run_all.sh), got: $FILTERED_PBF"
    exit 1
fi
BASE_PREFIX="${FILTERED_PBF%_proposed.osm.pbf}"

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

MISSING=()
command -v osmium  &>/dev/null || MISSING+=("osmium (https://osmcode.org/osmium-tool/)")
command -v curl    &>/dev/null || MISSING+=("curl")
command -v python3 &>/dev/null || MISSING+=("python3")

if [[ ${#MISSING[@]} -gt 0 ]]; then
    log_error "missing required dependencies:"
    for dep in "${MISSING[@]}"; do log_info "  - $dep"; done
    exit 1
fi

MISSING_PY=()
python3 -c "import osmium"  2>/dev/null || MISSING_PY+=("osmium  (pip install osmium)")
python3 -c "import shapely" 2>/dev/null || MISSING_PY+=("shapely  (pip install shapely)")

if [[ ${#MISSING_PY[@]} -gt 0 ]]; then
    log_error "missing required Python packages:"
    for pkg in "${MISSING_PY[@]}"; do log_info "  - $pkg"; done
    exit 1
fi

if [[ "$DO_IMPORT" -eq 1 ]]; then
    command -v bun &>/dev/null || { log_error "bun not found (required for --import)"; exit 1; }
fi

# ---------------------------------------------------------------------------
# Clear intermediates from any previously-interrupted run, before the disk
# check, so a stale orphan does not falsely trip the free-space requirement.
# _seq*.osm.pbf covers files left behind by older per-sequence versions.
# ---------------------------------------------------------------------------

if [[ "$DRY_RUN" -eq 0 ]]; then
    rm -f "${WORK_DIR}/daily_diff_"*.osc.gz
    rm -f "${WORK_DIR}/.osmium_filters_"*.txt
    rm -f "${FILTERED_PBF%.osm.pbf}_seq"*.osm.pbf
    rm -f "${FILTERED_PBF%.osm.pbf}_refiltered.osm.pbf"
    rm -f "$FINAL_PBF"
fi

# ---------------------------------------------------------------------------
# Disk space check
# ---------------------------------------------------------------------------

# Working-space budget for the worldwide subset: 9 GiB, not a size estimate
# for arbitrary regional inputs. Catch-up runs may need more for downloaded diffs.
REQUIRED_SPACE_KB=9437184
AVAILABLE_SPACE_KB=$(df -P -k "$WORK_DIR" | tail -1 | awk '{print $4}')

if [[ "$AVAILABLE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]]; then
    log_error "Not enough free disk space in $WORK_DIR."
    log_info "  Available: $((AVAILABLE_SPACE_KB / 1024 / 1024)) GiB"
    log_info "  Required:  9 GiB (worldwide update working-space budget)"
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[dry-run] $*"
    else
        osm_run "$@"
    fi
}

function import_features() {
    if [[ "$DO_IMPORT" -eq 1 ]]; then
        osm_step_start import
        run bun run "$REPO_ROOT/back/src/scripts/import-osm.ts" \
            --input-prefix "${BASE_PREFIX}_proposed"
        osm_step_end
    else
        osm_step_skip import disabled
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
log_debug "STEP 1: Reading replication timestamp"

STATE_FILE="${FILTERED_PBF}.replication-state"

if [[ -f "$STATE_FILE" ]]; then
    # Sidecar file written by a previous run of this script: sequenceNumber=NNN\ntimestamp=...
    REPL_TIMESTAMP=$(grep "^timestamp="      "$STATE_FILE" | cut -d= -f2 | tr -d '[:space:]' || true)
    LAST_SEQNUM=$(   grep "^sequenceNumber=" "$STATE_FILE" | cut -d= -f2 | tr -d '[:space:]' || true)
    REPLICATION_SOURCE=sidecar
    log_debug "  timestamp:      $REPL_TIMESTAMP"
    log_debug "  sequenceNumber: ${LAST_SEQNUM:-(not found)}"
elif [[ -n "${REPL_TIMESTAMP:-}" ]]; then
    REPLICATION_SOURCE=environment
    log_debug "  timestamp: $REPL_TIMESTAMP"
else
    # Fall back to the PBF header (present on fresh planet downloads)
    # osmium fileinfo (without -e) reads only PBF headers. The -e flag would
    # scan every object in the file, which on a multi-GB planet is ~2min wasted.
    FILEINFO=$(osmium fileinfo "$FILTERED_PBF" 2>/dev/null)
    REPL_TIMESTAMP=$(echo "$FILEINFO" | grep -i "osmosis_replication_timestamp" | sed 's/.*= *//' | tr -d '[:space:]' || true)
    REPLICATION_SOURCE=pbf_header
    log_debug "  osmosis_replication_timestamp: ${REPL_TIMESTAMP:-(not found)}"
fi

# The timestamp is only needed to binary-search the starting sequence. When the
# sidecar carries a sequence number, resumption works without it (a sidecar with
# a blank timestamp happens when the state.txt fetch failed at the end of a run).
if [[ -z "$REPL_TIMESTAMP" && -z "${LAST_SEQNUM:-}" ]]; then
    log_error "Could not determine replication timestamp."
    log_info "On the first run after a fresh planet filter this is read from the PBF header."
    log_info "On subsequent runs it is read from the sidecar file: $STATE_FILE"
    log_info "If the sidecar file is missing, pass the timestamp manually:"
    log_info "  REPL_TIMESTAMP=2026-03-16T01:00:01Z ./update_daily.sh ..."
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
log_debug "STEP 2: Resolving OSC sequence number for ${REPL_TIMESTAMP:-sidecar sequence ${LAST_SEQNUM:-?}}"

REPL_BASE_URL="https://planet.openstreetmap.org/replication/day"

# Fetch the current (latest) state to know the maximum sequence number
CURRENT_STATE=$(curl -sfL "${REPL_BASE_URL}/state.txt") || true
if [[ -z "$CURRENT_STATE" ]]; then
    log_error "Failed to fetch current replication state from ${REPL_BASE_URL}/state.txt"
    log_info "Check network access or verify the URL is reachable."
    exit 1
fi
CURRENT_SEQNUM=$(echo "$CURRENT_STATE" | grep "^sequenceNumber=" | cut -d= -f2 | tr -d '[:space:]' || true)
CURRENT_TS=$(echo "$CURRENT_STATE"     | grep "^timestamp="      | cut -d= -f2 | tr -d '[:space:]' || true)
if [[ -z "$CURRENT_SEQNUM" ]]; then
    log_error "Could not parse sequenceNumber from state.txt. Got:"
    log_info "$CURRENT_STATE"
    exit 1
fi

log_debug "  Current replication sequence: $CURRENT_SEQNUM  ($CURRENT_TS)"

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

# If the sidecar recorded the last applied sequence number, start from the next one directly.
# Otherwise binary-search to find the last sequence whose timestamp <= PBF timestamp,
# then start from seq+1 (OSM state timestamps represent the state *after* that sequence,
# so starting at that sequence would re-apply already-included changes).
if [[ -n "${LAST_SEQNUM:-}" ]]; then
    FOUND_SEQ="$LAST_SEQNUM"
    FOUND_TS=$(fetch_seq_timestamp "$FOUND_SEQ")
    log_debug "  Resuming from sidecar sequence: $FOUND_SEQ  ($FOUND_TS)"
else
    PBF_EPOCH=$(ts_to_epoch "$REPL_TIMESTAMP")
    if [[ "$PBF_EPOCH" -eq 0 ]]; then
        log_error "Could not parse timestamp: $REPL_TIMESTAMP"
        exit 1
    fi
    log_debug "  PBF timestamp epoch: $PBF_EPOCH"
    log_debug "  Binary-searching for matching sequence number..."

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
        log_error "Could not find a replication sequence <= PBF timestamp."
        log_info "The PBF may be older than the oldest available daily diff."
        exit 1
    fi

    FOUND_TS=$(fetch_seq_timestamp "$FOUND_SEQ")
    log_debug "  Matched sequence: $FOUND_SEQ  ($FOUND_TS)"
fi

START_SEQ=$(( FOUND_SEQ + 1 ))
TOTAL_DIFFS=$(( CURRENT_SEQNUM > FOUND_SEQ ? CURRENT_SEQNUM - FOUND_SEQ : 0 ))
OSM_LOG_SUMMARY=("source_sequence=$FOUND_SEQ" "target_sequence=$CURRENT_SEQNUM"
    "diffs=$TOTAL_DIFFS" "replication_timestamp=$CURRENT_TS" "input=$FILTERED_PBF")
log_info "Resolved replication range" "event=replication_resolved" \
    "source=$REPLICATION_SOURCE" "${OSM_LOG_SUMMARY[@]}"

# Nothing to do: PBF is already at the latest published sequence.
# But verify that extraction artifacts from the previous run are intact: each one
# must be non-empty and no older than the sidecar (step 4 runs after the sidecar
# write, so a successful run always leaves artifacts newer than it; an older or
# empty one is left over from an interrupted step 4, e.g. an OOM). In that case
# fall through and re-run step 4 without re-applying any diffs.
if [[ "$START_SEQ" -gt "$CURRENT_SEQNUM" ]]; then
    _ARTIFACTS_OK=1
    for _f in "${BASE_PREFIX}_proposed_ways.osm.pbf" \
              "${BASE_PREFIX}_proposed_areal.osm.pbf" \
              "${BASE_PREFIX}_proposed_relations.osm.pbf" \
              "${BASE_PREFIX}_proposed_linear.geojson" \
              "${BASE_PREFIX}_proposed_areal.geojson"; do
        if [[ ! -s "$_f" || "$_f" -ot "$STATE_FILE" ]]; then
            log_warn "Extraction artifact is missing, empty, or older than replication state; rebuilding" \
                "event=extraction_recovery" "artifact=$_f"
            _ARTIFACTS_OK=0
            break
        fi
    done
    if [[ "$_ARTIFACTS_OK" -eq 1 ]]; then
        for _step in download apply refilter derive backfill extraction; do
            osm_step_skip "$_step" already_current
        done
        import_features
        if [[ "$DO_IMPORT" -eq 0 ]]; then
            OSM_LOG_STATUS=unchanged
        fi
        exit 0
    fi
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

# Phase 1: download every OSC in range.
OSC_FILES=()
if [[ "$TOTAL_DIFFS" -gt 0 ]]; then
    osm_step_start download "diffs=$TOTAL_DIFFS"
    for SEQ in $(seq "$START_SEQ" "$CURRENT_SEQNUM"); do
        PADDED=$(printf "%09d" "$SEQ")
        P1="${PADDED:0:3}"
        P2="${PADDED:3:3}"
        P3="${PADDED:6:3}"
        OSC_URL="${REPL_BASE_URL}/${P1}/${P2}/${P3}.osc.gz"
        OSC_FILE="${WORK_DIR}/daily_diff_${PADDED}.osc.gz"

        log_debug "Downloading diff" "sequence=$SEQ" "url=$OSC_URL"
        run curl -sfL -o "$OSC_FILE" "$OSC_URL" || {
            log_error "Failed to download $OSC_URL"
            exit 1
        }
        if [[ "$DRY_RUN" -eq 0 ]]; then
            log_info "Downloaded diff" "event=diff_downloaded" "sequence=$SEQ" \
                "size_bytes=$(wc -c < "$OSC_FILE" | tr -d '[:space:]')"
        fi
        OSC_FILES+=("$OSC_FILE")
    done
    osm_step_end
else
    osm_step_skip download no_new_diffs
fi

# Phase 2: apply all diffs in one osmium call.
# Skipped when falling through from the "already up to date but extraction
# incomplete" path (no new diffs exist, so there is nothing to merge).
if [[ ${#OSC_FILES[@]} -gt 0 ]]; then
    osm_step_start apply "input=$FILTERED_PBF" "output=$FINAL_PBF" "diffs=$TOTAL_DIFFS"
    osm_trim_before_write "$FINAL_PBF"
    run osmium apply-changes \
        --overwrite \
        --output-format=pbf,pbf_compression=lz4 \
        -o "$FINAL_PBF" \
        "$FILTERED_PBF" \
        "${OSC_FILES[@]}"
    osm_step_end

    # $FINAL_PBF now holds everything in $FILTERED_PBF plus the diffs, so the
    # original is redundant. Drop it before the re-filter pass so peak disk stays
    # at two copies (merged + re-filtered) rather than three. A crash before the
    # final swap is recovered by promoting $FINAL_PBF back at startup.
    run rm -f "$FILTERED_PBF"

    # apply-changes merges every changed object from the diffs, filtered or not.
    # Re-filter (same rules as filter_combined.sh step 1) so the PBF only keeps
    # matching objects and does not grow with unrelated planet data on every run.
    osm_step_start refilter "input=$FINAL_PBF"
    REFILTER_RULES="${WORK_DIR}/.osmium_filters_$$.txt"
    REFILTERED_PBF="${FILTERED_PBF%.osm.pbf}_refiltered.osm.pbf"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[dry-run] build_combined_filters.sh > $REFILTER_RULES"
    else
        "$SCRIPT_DIR/build_combined_filters.sh" > "$REFILTER_RULES"
    fi
    osm_trim_before_write "$REFILTERED_PBF"
    run osmium tags-filter \
        --overwrite \
        --output-format=pbf,pbf_compression=lz4 \
        -o "$REFILTERED_PBF" \
        "$FINAL_PBF" \
        -e "$REFILTER_RULES"
    run rm -f "$REFILTER_RULES"
    run mv -f "$REFILTERED_PBF" "$FINAL_PBF"
    osm_step_end

    # Phase 3: clean up the OSCs now that they're baked into $FINAL_PBF.
    if [[ "$DRY_RUN" -eq 0 ]]; then
        rm -f "${OSC_FILES[@]}"
    fi

    # Rename the updated PBF into place under the canonical name. This happens
    # before the sidecar write below: the recorded sequence must never run ahead
    # of the file it describes.
    run mv -f "$FINAL_PBF" "$FILTERED_PBF"
    if [[ "$DRY_RUN" -eq 0 ]]; then
        log_info "Updated subset PBF" "event=artifact_written" "output=$FILTERED_PBF" \
            "size_bytes=$(wc -c < "$FILTERED_PBF" | tr -d '[:space:]')"
    fi

    # Write sidecar state file so the next run knows where to resume.
    # osmium apply-changes does not preserve the replication header, so we track
    # the sequence number and its timestamp ourselves.
    FINAL_SEQ_TS=$(fetch_seq_timestamp "$CURRENT_SEQNUM")
    if [[ "$DRY_RUN" -eq 0 ]]; then
        printf "sequenceNumber=%s\ntimestamp=%s\n" "$CURRENT_SEQNUM" "$FINAL_SEQ_TS" > "$STATE_FILE"
        log_info "Saved replication state" "event=replication_saved" "state_file=$STATE_FILE" \
            "sequence=$CURRENT_SEQNUM" "timestamp=$FINAL_SEQ_TS"
    else
        log_info "[dry-run] write $STATE_FILE: sequenceNumber=$CURRENT_SEQNUM timestamp=$FINAL_SEQ_TS"
    fi
else
    osm_step_skip apply no_new_diffs
    osm_step_skip refilter no_new_diffs
fi

# ---------------------------------------------------------------------------
# Step 4: Derive ways/areal/relations sub-PBFs and run Python extraction
# ---------------------------------------------------------------------------

# BASE_PREFIX = /path/to/<base> (the _proposed.osm.pbf suffix stripped near the top)
WAYS_PBF="${BASE_PREFIX}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE_PREFIX}_proposed_areal.osm.pbf"
RELATIONS_PBF="${BASE_PREFIX}_proposed_relations.osm.pbf"
LINEAR_GEOJSON="${BASE_PREFIX}_proposed_linear.geojson"
AREAL_GEOJSON="${BASE_PREFIX}_proposed_areal.geojson"

# Split the caught-up subset into the focused files the Python extraction reads.
# derive_subpbfs.sh is the single source of truth for this step (also runnable
# standalone to rebuild the sub-PBFs while iterating on the Python extraction).
DERIVE_DRY=""
[[ "$DRY_RUN" -eq 1 ]] && DERIVE_DRY="--dry-run"
TRIM_ARGS=()
[[ "$OSM_TRIM_BEFORE_WRITE" -eq 0 ]] || TRIM_ARGS=(--trim)
osm_step_start derive
osm_run "$SCRIPT_DIR/derive_subpbfs.sh" "$FILTERED_PBF" $DERIVE_DRY "${TRIM_ARGS[@]}"
osm_step_end

# Backfill geometry for construction elements re-tagged by the diffs. Their
# unchanged nodes/members were never in the filtered PBF, so they would be dropped
# by the Python extraction. Detection runs against the focused sub-PBFs (ways +
# areal) so route/public_transport relation members (carried in the main PBF but
# never rendered) are not mistaken for missing construction geometry.
#
# Fetched geometry is merged into the sub-PBFs (so the current run's Python
# extraction sees it) and into the main PBF (so it persists). The next re-derive
# keeps objects referenced by matching ways, so the baked-in nodes flow back into
# the freshly rebuilt sub-PBFs and detection only finds the new delta. Merging
# into the main PBF is what makes the fetched geometry survive future runs.
# Best-effort: a failure here never aborts the run.
if [[ "$DO_BACKFILL" -eq 1 ]]; then
    osm_step_start backfill
    BACKFILL_RC=0

    BACKFILL_DRY=""
    [[ "$DRY_RUN" -eq 1 ]] && BACKFILL_DRY="--dry-run"
    osm_run "$SCRIPT_DIR/backfill_geometry.sh" \
        "$WAYS_PBF" "$AREAL_PBF" "$FILTERED_PBF" \
        --detect "$WAYS_PBF" --detect "$AREAL_PBF" \
        $BACKFILL_DRY "${TRIM_ARGS[@]}" \
        || BACKFILL_RC=$?
    case "$BACKFILL_RC" in
        0) BACKFILL_STATUS=success ;;
        2) BACKFILL_STATUS=partial ;;
        *) BACKFILL_STATUS=failed ;;
    esac
    if [[ "$BACKFILL_RC" -ne 0 ]]; then
        OSM_LOG_STATUS=partial
        log_warn "Continuing with incomplete backfill" "event=backfill_incomplete" \
            "status=$BACKFILL_STATUS" "exit_code=$BACKFILL_RC"
    fi
    osm_step_end "$BACKFILL_STATUS"
    OSM_LOG_SUMMARY+=("backfill_status=$BACKFILL_STATUS")
else
    osm_step_skip backfill disabled
    OSM_LOG_SUMMARY+=("backfill_status=skipped")
fi
osm_step_start extraction "workers=2"
run python3 "$SCRIPT_DIR/extract_linear_topo.py" \
    --ways-file "$WAYS_PBF" \
    --source-file "$RELATIONS_PBF" \
    --output "$LINEAR_GEOJSON" &
PID_LINEAR=$!

run python3 "$SCRIPT_DIR/extract_areal_buildings.py" \
    --source "$AREAL_PBF" \
    --output "$AREAL_GEOJSON" &
PID_AREAL=$!

# Collect both statuses before failing, so one extractor failing does not leave
# the other running as an orphan that races a subsequent retry.
RC_LINEAR=0
RC_AREAL=0
wait $PID_LINEAR || RC_LINEAR=$?
wait $PID_AREAL  || RC_AREAL=$?
[[ "$RC_LINEAR" -eq 0 ]] || { log_error "Extractor failed" "worker=linear" "exit_code=$RC_LINEAR"; exit 1; }
[[ "$RC_AREAL"  -eq 0 ]] || { log_error "Extractor failed" "worker=areal" "exit_code=$RC_AREAL"; exit 1; }
osm_step_end

# ---------------------------------------------------------------------------
# Step 5: DB import (optional)
# ---------------------------------------------------------------------------

import_features
