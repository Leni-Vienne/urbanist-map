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
# update_daily.sh calls this after the diff catch-up. Run it standalone to rebuild
# the sub-PBFs when iterating on the Python extraction, without re-applying diffs.
#
# Usage:
#   ./derive_subpbfs.sh <base>_proposed.osm.pbf [--dry-run] [--trim]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/osm_log.sh"
source "$SCRIPT_DIR/osm_disk.sh"

DRY_RUN=0
SOURCE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --trim)        OSM_TRIM_BEFORE_WRITE=1 ;;
        --dry-run) DRY_RUN=1 ;;
        --*)       log_error "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$SOURCE" ]]; then log_error "Unexpected argument: $1"; exit 1; fi
            SOURCE="$1"
            ;;
    esac
    shift
done

if [[ -z "$SOURCE" ]]; then
    log_error "Usage: $0 <base>_proposed.osm.pbf [--dry-run] [--trim]"
    exit 1
fi
if [[ ! -f "$SOURCE" ]]; then
    log_error "source file not found: $SOURCE"
    exit 1
fi
# Suffix-anchored: the derived names below strip _proposed.osm.pbf, and a silent
# no-op strip on a mismatched name would produce paths like foo.osm.pbf_proposed_ways.osm.pbf.
if [[ "$SOURCE" != *_proposed.osm.pbf ]]; then
    log_error "expected a *_proposed.osm.pbf file, got: $SOURCE"
    exit 1
fi
command -v osmium &>/dev/null || { log_error "osmium not found"; exit 1; }

SOURCE="$(realpath "$SOURCE")"
LINEAR_FILTERS="$SCRIPT_DIR/linear_filters.txt"
AREAL_FILTERS="$SCRIPT_DIR/areal_filters.txt"

function run()      { if [[ "$DRY_RUN" -eq 1 ]]; then log_info "[dry-run] $*"; else osm_run "$@"; fi; }

BASE_PREFIX="${SOURCE%_proposed.osm.pbf}"
WAYS_PBF="${BASE_PREFIX}_proposed_ways.osm.pbf"
AREAL_PBF="${BASE_PREFIX}_proposed_areal.osm.pbf"
RELATIONS_PBF="${BASE_PREFIX}_proposed_relations.osm.pbf"

# libosmium's PBF parser uses a pool per process: OSMIUM_POOL_THREADS, default
# nproc-2 (4 on the 6-core host). Four per worker benchmarked faster than
# 1/2/3/6/8 for these three concurrent workers. `num_threads` is not an osmium
# option; it is silently ignored, so do not pass it.
osm_step_start derive "input=$SOURCE" "workers=3" "pool=${OSMIUM_POOL_THREADS:-auto}"
# All three outputs share a directory; finish one trim before any worker writes.
osm_trim_before_write "$WAYS_PBF"
run osmium tags-filter --overwrite --input-format=pbf \
    -o "$WAYS_PBF" "$SOURCE" -e "$LINEAR_FILTERS" &
PID_WAYS=$!
run osmium tags-filter --overwrite --input-format=pbf \
    -o "$AREAL_PBF" "$SOURCE" -e "$AREAL_FILTERS" &
PID_AREAL=$!
run osmium cat --overwrite --input-format=pbf \
    --object-type=relation -o "$RELATIONS_PBF" "$SOURCE" &
PID_REL=$!
# Collect all statuses before failing, so one job failing does not leave the
# others running as orphans that race a subsequent retry.
RC_WAYS=0; RC_AREAL=0; RC_REL=0
wait $PID_WAYS  || RC_WAYS=$?
wait $PID_AREAL || RC_AREAL=$?
wait $PID_REL   || RC_REL=$?
[[ "$RC_WAYS"  -eq 0 ]] || { log_error "Derivation failed" "worker=ways" "exit_code=$RC_WAYS"; exit 1; }
[[ "$RC_AREAL" -eq 0 ]] || { log_error "Derivation failed" "worker=areal" "exit_code=$RC_AREAL"; exit 1; }
[[ "$RC_REL"   -eq 0 ]] || { log_error "Derivation failed" "worker=relations" "exit_code=$RC_REL"; exit 1; }

osm_step_end
if [[ "$DRY_RUN" -eq 0 ]]; then
    for output in "$WAYS_PBF" "$AREAL_PBF" "$RELATIONS_PBF"; do
        log_info "Wrote sub-PBF" "event=artifact_written" "output=$output" \
            "size_bytes=$(wc -c < "$output" | tr -d '[:space:]')"
    done
fi
