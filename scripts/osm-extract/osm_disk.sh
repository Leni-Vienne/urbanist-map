# Shared disk preparation for large PBF writes. Source after osm_log.sh.
OSM_TRIM_BEFORE_WRITE=0

osm_trim_before_write() {
    local output=$1 mountpoint details tool
    [[ "$OSM_TRIM_BEFORE_WRITE" -eq 1 ]] || return 0
    if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
        log_info "[dry-run] fstrim destination filesystem before PBF write" "output=$output"
        return 0
    fi

    # TRIM is an optimization: unsupported filesystems, missing tools, or a lack
    # of privileges must not prevent an otherwise valid extraction.
    for tool in findmnt fstrim; do
        if ! command -v "$tool" >/dev/null; then
            log_warn "Skipping filesystem trim: $tool not found" "output=$output"
            return 0
        fi
    done
    if ! mountpoint=$(findmnt --noheadings --output TARGET --target "$(dirname -- "$output")" 2>/dev/null) \
        || [[ -z "$mountpoint" ]]; then
        log_warn "Could not resolve destination filesystem for trim" "output=$output"
        return 0
    fi

    log_info "Trimming destination filesystem before PBF write" \
        "output=$output" "mountpoint=$mountpoint"
    if details=$(fstrim --verbose -- "$mountpoint" 2>&1); then
        log_info "Filesystem trim completed" "mountpoint=$mountpoint" "details=${details:0:4096}"
    else
        log_warn "Filesystem trim failed; continuing PBF write" \
            "mountpoint=$mountpoint" "details=${details:0:4096}"
    fi
    return 0
}
