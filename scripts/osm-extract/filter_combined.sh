#!/usr/bin/env bash
# Filter a planet/region PBF down to the proposed/construction subset.
#
# Usage:
#   ./filter_combined.sh <source.osm.pbf> [--trim]
#
# Output:
#   *_proposed.osm.pbf , ways + areas + route relations matching the construction
#                        rules (build_combined_filters.sh)
#
# This is the expensive reduction: ~30-40 min on a full planet (all cores), a few
# minutes on a country extract. The result is geometry-complete but only as fresh
# as the source snapshot. Advancing it to the current day and turning it into
# GeoJSON is update_daily.sh's job, so this script deliberately does no
# derivation or extraction.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/osm_log.sh"
source "$SCRIPT_DIR/osm_disk.sh"

SOURCE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --trim) OSM_TRIM_BEFORE_WRITE=1 ;;
        --*) log_error "Unknown flag: $1"; exit 1 ;;
        *)
            if [[ -n "$SOURCE" ]]; then log_error "Unexpected argument: $1"; exit 1; fi
            SOURCE="$1"
            ;;
    esac
    shift
done
if [[ -z "$SOURCE" ]]; then
    log_error "Usage: $0 <source.osm.pbf> [--trim]"
    exit 1
fi
if [ ! -f "$SOURCE" ]; then
    log_error "source file not found: $SOURCE"
    exit 1
fi
# Suffix-anchored: a name not ending in .osm.pbf would otherwise make
# OUTPUT == SOURCE and osmium --overwrite would destroy the source.
if [[ "$SOURCE" != *.osm.pbf ]]; then
    log_error "source file must end in .osm.pbf: $SOURCE"
    exit 1
fi
OUTPUT="${SOURCE%.osm.pbf}_proposed.osm.pbf"

log_info "Filter configuration" "input=$SOURCE" "output=$OUTPUT" \
    "input_size_bytes=$(wc -c < "$SOURCE" | tr -d '[:space:]')" \
    "compression=lz4"
osm_step_start filter

COMBINED_FILTERS="$(dirname "$OUTPUT")/.osmium_filters_$$.txt"
trap 'rc=$?; rm -f "$COMBINED_FILTERS"; osm_log_exit "$rc"' EXIT
"$SCRIPT_DIR/build_combined_filters.sh" > "$COMBINED_FILTERS"

osm_trim_before_write "$OUTPUT"
osm_run osmium tags-filter \
    --overwrite \
    --output-format=pbf,pbf_compression=lz4 \
    -o "$OUTPUT" \
    "$SOURCE" \
    -e "$COMBINED_FILTERS"

rm -f "$COMBINED_FILTERS"
trap 'osm_log_exit "$?"' EXIT
osm_step_end
log_info "Wrote subset PBF" "event=artifact_written" "output=$OUTPUT" \
    "size_bytes=$(wc -c < "$OUTPUT" | tr -d '[:space:]')"
