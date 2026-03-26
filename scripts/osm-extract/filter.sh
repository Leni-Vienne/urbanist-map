#!/usr/bin/env bash
# Usage: ./filter.sh <source.osm.pbf>
# Extracts proposed and under-construction linear transport ways into a smaller PBF.
# Covers railways, roads, aerialways, waterways, cycling and pedestrian paths.
# Run this first, then run extract_linear_topo.py.

set -e

SOURCE="${1:?Usage: $0 <source.osm.pbf>}"
OUTPUT="${SOURCE/.osm.pbf/_proposed_linear.osm.pbf}"

echo "Filtering $SOURCE -> $OUTPUT"
osmium tags-filter \
    --overwrite \
    -o "$OUTPUT" \
    "$SOURCE" \
    w/railway=proposed \
    w/railway=construction \
    w/highway=proposed \
    w/highway=construction \
    w/waterway=proposed \
    w/waterway=construction \
    w/aerialway=proposed \
    w/aerialway=construction \
    w/construction=rail \
    w/construction=light_rail \
    w/construction=tram \
    w/construction=subway \
    w/construction=narrow_gauge \
    w/construction=monorail \
    w/construction=miniature \
    w/construction=motorway \
    w/construction=trunk \
    w/construction=primary \
    w/construction=secondary \
    w/construction=tertiary \
    w/construction=residential \
    w/construction=unclassified \
    w/construction=service \
    w/construction=living_street \
    w/construction=bus_guideway \
    w/construction=cycleway \
    w/construction=footway \
    w/construction=pedestrian \
    w/construction=path \
    w/construction=canal \
    w/construction=river \
    w/construction=stream \
    w/construction=cable_car \
    w/construction=gondola \
    w/construction=funicular \
    w/construction=chair_lift \
    w/proposed=rail \
    w/proposed=light_rail \
    w/proposed=tram \
    w/proposed=subway \
    w/proposed=narrow_gauge \
    w/proposed=monorail \
    w/proposed=miniature \
    w/proposed=motorway \
    w/proposed=trunk \
    w/proposed=primary \
    w/proposed=secondary \
    w/proposed=tertiary \
    w/proposed=residential \
    w/proposed=unclassified \
    w/proposed=service \
    w/proposed=living_street \
    w/proposed=bus_guideway \
    w/proposed=cycleway \
    w/proposed=footway \
    w/proposed=pedestrian \
    w/proposed=path \
    w/proposed=canal \
    w/proposed=river \
    w/proposed=stream \
    w/proposed=cable_car \
    w/proposed=gondola \
    w/proposed=funicular \
    w/proposed=chair_lift

echo "Done: $OUTPUT"
