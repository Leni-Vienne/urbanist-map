#!/usr/bin/env bash
# Usage: ./filter_areal.sh <source.osm.pbf>
# Extracts proposed and under-construction buildings and landuse areas.

set -e

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"
OUTPUT="${SOURCE/.osm.pbf/_proposed_areal.osm.pbf}"

echo "Filtering areal features $SOURCE -> $OUTPUT"
osmium tags-filter \
    --overwrite \
    -o "$OUTPUT" \
    "$SOURCE" \
    wr/building=construction \
    wr/building=proposed \
    wr/landuse=construction \
    wr/landuse=brownfield \
    wr/construction=apartments \
    wr/construction=commercial \
    wr/construction=office \
    wr/construction=retail \
    wr/construction=industrial \
    wr/construction=yes \
    wr/proposed=apartments \
    wr/proposed=commercial \
    wr/proposed=office \
    wr/proposed=retail \
    wr/proposed=industrial

echo "Done: $OUTPUT"
