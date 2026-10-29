#!/usr/bin/env bash
# Backfill geometry for elements that gained proposed/construction tags via a diff.
#
# When a pre-existing OSM element is re-tagged to construction, the daily OSC diff
# carries the full element (all tags and node/member references), but NOT the
# referenced nodes/ways whose own data did not change. Those were never in the
# filtered PBF (the element was not construction before), so the merged PBF ends
# up with the element present but its geometry dangling:
#   - a way with node references but no node coordinates
#   - a relation with member references but no member ways/nodes
# extract_linear_topo.py / extract_areal_buildings.py then silently drop such
# elements (they keep only nodes whose location is valid).
#
# This script resolves those dangling references by:
#   1. osmium check-refs , list the IDs of missing nodes/ways/relations
#   2. fetch by ID        , plain nodes come from the OSM API multi-fetch endpoint
#                           (separate infrastructure, not Overpass-rate-limited);
#                           ways/relations come from Overpass with full member
#                           recursion. A node batch that 4xxs (one deleted id
#                           poisons the whole OSM API batch) falls back to Overpass,
#                           which simply omits ids it cannot find.
#   3. osmium merge       , merge the fetched geometry into the target PBF(s)
# It iterates because a fetched relation member way can itself pull in more refs.
#
# DETECT vs MERGE targets
# -----------------------
# The main _proposed.osm.pbf carries route/public_transport relation members
# (ordinary roads) whose geometry the extraction never uses but whose nodes get
# shed across the apply-changes/re-filter cycle. Running check-refs on it would
# report hundreds of thousands of those irrelevant dangling refs. So detection
# is pointed at the focused sub-PBFs (construction ways/areas only) via --detect,
# while the fetched geometry is merged into every positional target (typically
# the sub-PBFs for the current run plus the main PBF so the geometry persists and
# is not re-fetched on the next run). With no --detect, detection falls back to
# the first target (standalone use).
#
# A target that does not exist yet is created from the fetched geometry. Existing
# targets are only replaced on a successful merge, so an interrupted or failed run
# leaves inputs untouched. Exit 0 means complete, 2 means partial (unresolved refs
# or a failed merge), and 1 means failure. update_daily.sh continues on 1 or 2.
#
# Usage:
#   ./backfill_geometry.sh <target.osm.pbf> [more-targets...] [options]
#
# Options:
#   --detect <pbf>       Scan this file for missing refs (repeatable). Should be a
#                        subset/derivative of the targets. Default: the first target.
#   --dry-run            Print what would be fetched, do not call the network or write
#   --trim               Trim the destination filesystem before each large merge
#   --endpoint URL       Overpass interpreter URL (default: public instance)
#   --osm-api URL        OSM API base for node multi-fetch (default: public instance)
#   --max-iters N        Max fetch/merge passes (default: 3)
#   --batch-nodes N      Node IDs per OSM API query (default: 500; higher risks a
#                        414 URI-too-long since the multi-fetch is a GET)
#   --batch-ways N       Way IDs per Overpass query (default: 150)
#   --batch-rels N       Relation IDs per Overpass query (default: 50)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/osm_log.sh"
source "$SCRIPT_DIR/osm_disk.sh"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

TARGET_FILES=()
DETECT_FILES=()
DRY_RUN=0
ENDPOINT="https://overpass-api.de/api/interpreter"
OSM_API="https://api.openstreetmap.org/api/0.6"
MAX_ITERS=3
BATCH_NODES=500
BATCH_WAYS=150
BATCH_RELS=50

# Server-side Overpass timeout (seconds) and client-side curl ceiling.
OV_TIMEOUT=180
CURL_TIMEOUT=300
# Politeness pause between Overpass queries and retry attempts.
OV_SLEEP=1
OV_RETRIES=3
# Above this many missing references the delta is suspicious; we still proceed but
# log a warning so the failure stays visible.
WARN_REFS=100000

UA="UrbanistMap-backfill/1.0 (osm-extract daily geometry backfill)"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --detect)      DETECT_FILES+=("${2:?--detect requires a path}"); shift ;;
        --trim)        OSM_TRIM_BEFORE_WRITE=1 ;;
        --dry-run)     DRY_RUN=1 ;;
        --endpoint)    ENDPOINT="${2:?--endpoint requires a URL}"; shift ;;
        --osm-api)     OSM_API="${2:?--osm-api requires a URL}"; shift ;;
        --max-iters)   MAX_ITERS="${2:?--max-iters requires a number}"; shift ;;
        --batch-nodes) BATCH_NODES="${2:?--batch-nodes requires a number}"; shift ;;
        --batch-ways)  BATCH_WAYS="${2:?--batch-ways requires a number}"; shift ;;
        --batch-rels)  BATCH_RELS="${2:?--batch-rels requires a number}"; shift ;;
        --*)           log_error "Unknown flag: $1"; exit 1 ;;
        *)             TARGET_FILES+=("$1") ;;
    esac
    shift
done

if [[ ${#TARGET_FILES[@]} -eq 0 ]]; then
    log_error "Usage: $0 <target.osm.pbf> [more-targets...] [--detect <pbf>] [--dry-run] [--trim]"
    exit 1
fi

# Default detection source: the first target.
if [[ ${#DETECT_FILES[@]} -eq 0 ]]; then
    DETECT_FILES=("${TARGET_FILES[0]}")
fi

# Detection sources must exist; a merge target may be missing (created on first
# merge in standalone use) but its directory must exist.
for f in "${DETECT_FILES[@]}"; do
    [[ -f "$f" ]] || { log_error "detect file not found: $f"; exit 1; }
done
for f in "${TARGET_FILES[@]}"; do
    d="$(dirname "$f")"
    [[ -d "$d" ]] || { log_error "target directory not found: $d"; exit 1; }
done

command -v osmium &>/dev/null || { log_error "osmium not found"; exit 1; }
command -v curl   &>/dev/null || { log_error "curl not found"; exit 1; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TMP_DIR="$(realpath "$(dirname "${TARGET_FILES[0]}")")/.backfill_$$"
mkdir -p "$TMP_DIR"
trap 'rc=$?; rm -rf "$TMP_DIR"; osm_log_exit "$rc"' EXIT

# Print a short human reason for a failed HTTP fetch: a curl-level error (timeout,
# DNS, refused) or the HTTP status plus the first meaningful line of the body.
# Overpass puts "rate_limited" / "runtime error: ..." there; the OSM API returns a
# plain message. This is what surfaces the *why* in the logs.
function http_reason() {
    local out="$1" code="$2" rc="$3" snippet
    if [[ "$rc" -ne 0 ]]; then
        case "$rc" in
            28) echo "curl timeout after ${CURL_TIMEOUT}s (exit 28)" ;;
            6)  echo "could not resolve host (exit 6)" ;;
            7)  echo "connection failed (exit 7)" ;;
            *)  echo "curl error (exit $rc)" ;;
        esac
        return
    fi
    snippet=$(tr -d '\r' <"$out" 2>/dev/null \
        | grep -m1 -iE 'remark|error|rate_limited|too many|gateway|timeout|message' \
        | sed -E 's/<[^>]+>//g; s/^[[:space:]]+//' | head -c 160)
    [[ -z "$snippet" ]] && snippet=$(tr -d '\r' <"$out" 2>/dev/null \
        | grep -m1 -vE '^[[:space:]]*$' | head -c 160)
    echo "HTTP $code${snippet:+ , $snippet}"
}

# Wait for a free Overpass slot using /api/status so we pause exactly as long as the
# server says instead of guessing. No-op if status is unreachable or the instance
# advertises no rate limit.
function overpass_wait_slot() {
    local status_url="${ENDPOINT%/interpreter}/status" body wait
    body=$(curl -s -A "$UA" --max-time 30 "$status_url" 2>/dev/null) || return 0
    grep -qE 'slots? available now' <<<"$body" && return 0
    wait=$(grep -oE 'in [0-9]+ seconds' <<<"$body" | grep -oE '[0-9]+' | sort -n | head -1)
    if [[ -n "$wait" ]]; then
        wait=$((wait + 1))
        log_info "Waiting for an Overpass slot" "event=retry_wait" "wait_seconds=$wait"
        sleep "$wait"
    fi
    return 0
}

# POST an Overpass query into a file. Waits for a free slot before each attempt and
# logs the failure reason on each retry.
function fetch_overpass() {
    local query="$1" out="$2" code rc attempt
    for ((attempt = 1; attempt <= OV_RETRIES; attempt++)); do
        overpass_wait_slot
        code=$(curl -sS -A "$UA" --max-time "$CURL_TIMEOUT" -w '%{http_code}' \
            --data-urlencode "data=$query" "$ENDPOINT" -o "$out" 2>"${TMP_DIR}/curl.stderr")
        rc=$?
        [[ "$rc" -eq 0 && "$code" == "200" ]] && return 0
        log_warn "Overpass request failed: $(http_reason "$out" "$code" "$rc")" \
            "event=fetch_retry" "backend=overpass" "attempt=$attempt" "max_attempts=$OV_RETRIES" \
            "http_status=$code" "exit_code=$rc" "details=$(osm_failure_details "${TMP_DIR}/curl.stderr")"
        ((attempt < OV_RETRIES)) && sleep $((attempt * 5))
    done
    return 1
}

# GET an OSM API multi-fetch URL into a file. Returns 2 on a 4xx (a deleted/absent
# id poisons the whole batch, will not change on retry) so the caller can fall back
# to Overpass; returns 1 on other failures after retries.
function fetch_osm_api() {
    local url="$1" out="$2" code rc attempt
    for ((attempt = 1; attempt <= OV_RETRIES; attempt++)); do
        code=$(curl -sS -A "$UA" --max-time "$CURL_TIMEOUT" -w '%{http_code}' \
            "$url" -o "$out" 2>"${TMP_DIR}/curl.stderr")
        rc=$?
        [[ "$rc" -eq 0 && "$code" == "200" ]] && return 0
        if [[ "$rc" -eq 0 && "$code" =~ ^4 ]]; then
            log_warn "OSM API request rejected: $(http_reason "$out" "$code" "$rc")" \
                "event=fetch_fallback" "backend=osm_api" "http_status=$code" "exit_code=$rc"
            return 2
        fi
        log_warn "OSM API request failed: $(http_reason "$out" "$code" "$rc")" \
            "event=fetch_retry" "backend=osm_api" "attempt=$attempt" "max_attempts=$OV_RETRIES" \
            "http_status=$code" "exit_code=$rc" "details=$(osm_failure_details "${TMP_DIR}/curl.stderr")"
        ((attempt < OV_RETRIES)) && sleep $((attempt * 5))
    done
    return 1
}

# Fetch every ID of one type in batches, sort each batch to a PBF, and append the
# sorted PBF paths to the global FETCHED_PBFS array.
#   $1 = osm type (node|way|relation)   $2 = batch size   $3 = recurse members (0|1)
#   remaining args = the IDs
function fetch_type() {
    local otype="$1" bsize="$2" recurse="$3"; shift 3
    local ids=("$@")
    local total=${#ids[@]}
    [[ $total -eq 0 ]] && return 0

    local nbatches=$(( (total + bsize - 1) / bsize ))
    local b=0 start
    local via="Overpass"; [[ "$otype" == "node" ]] && via="OSM API"
    log_info "Fetching missing references" "event=fetch_started" \
        "object_type=$otype" "objects=$total" "batches=$nbatches" "backend=$via"

    for ((start = 0; start < total; start += bsize)); do
        b=$((b + 1))
        local chunk=("${ids[@]:start:bsize}")
        local joined
        printf -v joined '%s,' "${chunk[@]}"
        joined="${joined%,}"

        local raw="${TMP_DIR}/fetch_${otype}_${b}.osm"
        local sorted="${TMP_DIR}/fetch_${otype}_${b}.osm.pbf"
        log_debug "Fetching batch" "object_type=$otype" "batch=$b" "batches=$nbatches" "objects=${#chunk[@]}"

        if [[ "$DRY_RUN" -eq 1 ]]; then continue; fi

        local ok=0
        if [[ "$otype" == "node" ]]; then
            # Plain nodes: OSM API multi-fetch (separate infra, not rate-limited). A
            # 4xx means a deleted id poisoned the batch; fall back to Overpass, which
            # quietly omits ids it cannot resolve.
            fetch_osm_api "${OSM_API}/nodes?nodes=${joined}" "$raw"
            case $? in
                0) ok=1 ;;
                2) log_debug "Falling back to Overpass for absent node IDs" "batch=$b"
                   fetch_overpass "[out:xml][timeout:${OV_TIMEOUT}];node(id:${joined});out meta;" "$raw" && ok=1 ;;
            esac
        else
            local query
            if [[ "$recurse" -eq 1 ]]; then
                query="[out:xml][timeout:${OV_TIMEOUT}];${otype}(id:${joined});(._;>;);out meta;"
            else
                query="[out:xml][timeout:${OV_TIMEOUT}];${otype}(id:${joined});out meta;"
            fi
            fetch_overpass "$query" "$raw" && ok=1
        fi

        if [[ "$ok" -ne 1 ]]; then
            log_warn "Skipping failed fetch" "event=fetch_failed" "object_type=$otype" "batch=$b"
            rm -f "$raw"
            continue
        fi
        # osmium needs sorted input for merge; fetched output is not guaranteed sorted.
        osmium sort "$raw" -o "$sorted" --overwrite 2>"${TMP_DIR}/sort.stderr"
        local sort_rc=$?
        if [[ "$sort_rc" -ne 0 ]]; then
            log_warn "Skipping batch after osmium sort failed" "event=sort_failed" \
                "object_type=$otype" "batch=$b" "exit_code=$sort_rc" \
                "details=$(osm_failure_details "${TMP_DIR}/sort.stderr")"
            rm -f "$raw"
            continue
        fi
        rm -f "$raw"
        FETCHED_PBFS+=("$sorted")
        sleep "$OV_SLEEP"
    done
}

# Union the missing references across all detection sources into $1.
# Returns 0 if any source has missing refs, 1 if all are clean, 2 on check failure.
function collect_missing() {
    local out="$1" src rc any=1
    : >"$out"
    for src in "${DETECT_FILES[@]}"; do
        osmium check-refs -i -r "$src" >>"$out" 2>"${TMP_DIR}/check-refs.stderr"
        rc=$?
        if [[ "$rc" -eq 1 ]]; then
            any=0
        elif [[ "$rc" -gt 1 ]]; then
            log_error "osmium check-refs failed" "event=check_refs_failed" \
                "input=$src" "exit_code=$rc" "details=$(osm_failure_details "${TMP_DIR}/check-refs.stderr")"
            return 2
        fi
    done
    return $any
}

# Keep counting and reporting identical at every exit, including dry runs.
function read_missing_ids() {
    local raw=$1
    mapfile -t NODE_IDS < <(grep -oE '^n[0-9]+' "$raw" | cut -c2- | sort -un)
    mapfile -t WAY_IDS  < <(grep -oE '^w[0-9]+' "$raw" | cut -c2- | sort -un)
    mapfile -t REL_IDS  < <(grep -oE '^r[0-9]+' "$raw" | cut -c2- | sort -un)
}

function finish_backfill() {
    local check_rc=$1 raw=$2
    [[ "$check_rc" -eq 2 ]] && exit 1
    read_missing_ids "$raw"
    OSM_LOG_SUMMARY=("remaining_nodes=${#NODE_IDS[@]}" "remaining_ways=${#WAY_IDS[@]}"
        "remaining_relations=${#REL_IDS[@]}" "passes=$iter" "merge_failed=$MERGE_FAILED")
    if [[ "$DRY_RUN" -eq 0 && ( "$check_rc" -eq 0 || "$MERGE_FAILED" -ne 0 ) ]]; then
        OSM_LOG_STATUS=partial
        exit 2
    fi
    exit 0
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
log_debug "Backfill inputs" "detect=${DETECT_FILES[*]}" "targets=${TARGET_FILES[*]}"

iter=0
MERGE_FAILED=0
while ((iter < MAX_ITERS)); do
    iter=$((iter + 1))

    MISSING_RAW="${TMP_DIR}/missing.txt"
    collect_missing "$MISSING_RAW"
    CHECK_RC=$?
    if [[ "$CHECK_RC" -eq 2 ]]; then
        exit 1
    elif [[ "$CHECK_RC" -eq 1 ]]; then
        finish_backfill "$CHECK_RC" "$MISSING_RAW"
    fi

    read_missing_ids "$MISSING_RAW"

    TOTAL=$(( ${#NODE_IDS[@]} + ${#WAY_IDS[@]} + ${#REL_IDS[@]} ))
    log_info "Missing references" "event=missing_refs" "pass=$iter" "max_passes=$MAX_ITERS" \
        "nodes=${#NODE_IDS[@]}" "ways=${#WAY_IDS[@]}" "relations=${#REL_IDS[@]}"

    if [[ "$TOTAL" -gt "$WARN_REFS" ]]; then
        log_warn "Unusually many missing references; check the backfill inputs and replication state" \
            "references=$TOTAL" "threshold=$WARN_REFS"
    fi

    FETCHED_PBFS=()
    # Ways and relations are fetched with full recursion so their member geometry
    # arrives in the same response; plain nodes need no recursion.
    fetch_type node     "$BATCH_NODES" 0 "${NODE_IDS[@]}"
    fetch_type way      "$BATCH_WAYS"  1 "${WAY_IDS[@]}"
    fetch_type relation "$BATCH_RELS"  1 "${REL_IDS[@]}"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "Would merge fetched geometry" "targets=${TARGET_FILES[*]}"
        finish_backfill "$CHECK_RC" "$MISSING_RAW"
    fi

    if [[ ${#FETCHED_PBFS[@]} -eq 0 ]]; then
        log_warn "nothing fetched this pass (network failures or deleted upstream); stopping"
        break
    fi

    MERGE_FAILED=0
    for tgt in "${TARGET_FILES[@]}"; do
        merged="${tgt%.osm.pbf}_backfilled.osm.pbf"
        # A missing target is created from the fetched geometry alone; an existing
        # one is merged with it.
        if [[ -f "$tgt" ]]; then
            inputs=("$tgt" "${FETCHED_PBFS[@]}")
            log_info "Merging ${#FETCHED_PBFS[@]} fetched batch(es) into $tgt"
        else
            inputs=("${FETCHED_PBFS[@]}")
            log_info "Creating $tgt from ${#FETCHED_PBFS[@]} fetched batch(es)"
        fi
        osm_trim_before_write "$merged"
        if osmium merge --overwrite \
            --output-format=pbf,pbf_compression=lz4 \
            -o "$merged" "${inputs[@]}" && mv -f "$merged" "$tgt"; then
            :
        else
            log_warn "Could not merge and replace backfill target" "event=merge_failed" "output=$tgt"
            rm -f "$merged"
            MERGE_FAILED=1
        fi
    done
    rm -f "${FETCHED_PBFS[@]}"
    [[ "$MERGE_FAILED" -eq 1 ]] && break
done

# Final detection measures the remaining references rather than assuming every
# requested object was returned (deleted OSM objects may be omitted by the API).
collect_missing "${TMP_DIR}/final.txt"
finish_backfill "$?" "${TMP_DIR}/final.txt"
