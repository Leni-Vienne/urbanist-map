#!/usr/bin/env bash
# Filter a planet/region PBF down to the proposed/construction subset.
#
# Usage:
#   ./filter_combined.sh <source.osm.pbf>
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

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"
if [ ! -f "$SOURCE" ]; then
    echo "Error: source file not found: $SOURCE"
    exit 1
fi
OUTPUT="${SOURCE/.osm.pbf/_proposed.osm.pbf}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)

function ts() { date '+%H:%M:%S'; }
function elapsed() { local s=$1; printf "%dm%02ds" $((s / 60)) $((s % 60)); }
function filesize() { du -sh "$1" 2>/dev/null | cut -f1; }

echo ""
echo "[$(ts)] Filtering planet to construction subset (ways + areas + route relations)"
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
echo "[$(ts)] Filter done in $(elapsed $((SECONDS - T))), output: $(filesize "$OUTPUT")"
