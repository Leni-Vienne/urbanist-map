#!/usr/bin/env bash
# Usage: ./filter_relations.sh <source.osm.pbf>
# Extracts route/site/public_transport relations into a small PBF for relation scanning.
# Run this before extract_linear_topo.py when you already have the combined ways PBF
# and don't want to re-run the full filter.
#
# Output is much smaller than the planet (~1-2GB vs 86GB) so Pass 2 of the
# linear extraction script runs in seconds instead of many minutes.

set -e

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"
OUTPUT="${SOURCE/.osm.pbf/_route_relations.osm.pbf}"

echo "Filtering route relations $SOURCE -> $OUTPUT"
osmium tags-filter \
    --overwrite \
    -o "$OUTPUT" \
    "$SOURCE" \
    r/type=route \
    r/type=site \
    r/type=public_transport

echo "Done: $OUTPUT"
