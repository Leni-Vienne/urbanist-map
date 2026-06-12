#!/usr/bin/env bash
# Prints the combined osmium tags-filter rules to stdout (used by
# filter_combined.sh step 1 and the update_weekly.sh refilter).
#
# areal lines for construction/proposed/planned keys are demoted from wr/ to
# r/ because their way side is already covered by w/construction*,
# w/proposed*, w/planned* in linear_filters.txt; fewer way rules means less
# matching work per way during the planet pass.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat "$SCRIPT_DIR/linear_filters.txt"
sed -E 's@^wr/(construction|proposed|planned)@r/\1@' "$SCRIPT_DIR/areal_filters.txt"
printf 'r/type=route,site,public_transport\n'
