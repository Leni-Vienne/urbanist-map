# Shared logfmt logging for the Bash entry points. Logs go to stderr so stdout
# remains available for data (filter rules, timestamps, HTTP reasons, etc.).
OSM_LOG_COMPONENT="$(basename "${BASH_SOURCE[1]}" .sh)"
export OSM_RUN_ID="${OSM_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$BASHPID}"
_OSM_SCRIPT_STARTED=$SECONDS
_OSM_STEP=""
OSM_LOG_STATUS=success
OSM_LOG_SUMMARY=()
_OSM_LOG_THRESHOLD=20
_OSM_RESOURCE_FILE=""
_OSM_RESOURCE_HELPER="${BASH_SOURCE[0]%/*}/osm_resources.py"

osm_log() {
    local level="$1" message="$2" field value line
    shift 2
    local severity
    case "$level" in
        debug) severity=10 ;;
        info) severity=20 ;;
        warning) severity=30 ;;
        error) severity=40 ;;
    esac
    [[ "$severity" -lt "$_OSM_LOG_THRESHOLD" ]] && return 0
    local fields=("time=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "level=$level"
        "component=$OSM_LOG_COMPONENT" "run_id=$OSM_RUN_ID"
        "dry_run=${DRY_RUN:-0}" "message=$message" "$@")
    line=""
    for field in "${fields[@]}"; do
        value=${field#*=}
        value=${value//\\/\\\\}
        value=${value//\"/\\\"}
        value=${value//$'\n'/\\n}
        value=${value//$'\r'/\\r}
        value=${value//$'\t'/\\t}
        line+="${field%%=*}=\"$value\" "
    done
    # One write per record keeps parallel workers' messages together.
    printf '%s\n' "${line% }" >&2
}

log_debug() { osm_log debug "$@"; }
log_info()  { osm_log info "$@"; }
log_warn()  { osm_log warning "$@"; }
log_error() { osm_log error "$@"; }

osm_step_start() {
    _OSM_STEP=$1
    shift
    _OSM_STEP_STARTED=$SECONDS
    if [[ "${DRY_RUN:-0}" -eq 0 ]] && command -v python3 >/dev/null; then
        if ! _OSM_RESOURCE_FILE=$(python3 "$_OSM_RESOURCE_HELPER" start); then
            _OSM_RESOURCE_FILE=""
            log_warn "Resource accounting unavailable" "step=$_OSM_STEP"
        fi
    fi
    log_info "Starting step" "event=step_started" "step=$_OSM_STEP" "$@"
}

osm_run() {
    if [[ -n "$_OSM_RESOURCE_FILE" ]]; then
        python3 "$_OSM_RESOURCE_HELPER" record "$_OSM_RESOURCE_FILE" "$@"
    else
        "$@"
    fi
}

osm_resource_finish() {
    _OSM_RESOURCE_FIELDS=("duration_seconds=$((SECONDS - _OSM_STEP_STARTED))")
    if [[ -n "$_OSM_RESOURCE_FILE" ]]; then
        local summary
        if summary=$(python3 "$_OSM_RESOURCE_HELPER" summarize "$_OSM_RESOURCE_FILE"); then
            mapfile -t _OSM_RESOURCE_FIELDS <<<"$summary"
        else
            log_warn "Could not summarize step resources" "step=$_OSM_STEP"
        fi
        rm -f "$_OSM_RESOURCE_FILE"
        _OSM_RESOURCE_FILE=""
    fi
}

osm_step_end() {
    local status=${1:-success}
    [[ $# -eq 0 ]] || shift
    osm_resource_finish
    log_info "Finished step" "event=step_completed" "step=$_OSM_STEP" \
        "${_OSM_RESOURCE_FIELDS[@]}" "status=$status" "$@"
    _OSM_STEP=""
}

osm_step_skip() {
    log_info "Skipped step" "event=step_skipped" "step=$1" "reason=$2"
}

osm_log_exit() {
    local rc=$1 status=$OSM_LOG_STATUS level=info event=script_completed
    local resource_fields=() field
    if [[ -n "$_OSM_STEP" ]]; then
        osm_resource_finish
        for field in "${_OSM_RESOURCE_FIELDS[@]}"; do
            # Keep the script's total duration distinct from its failing phase.
            resource_fields+=("${field/#duration_seconds=/step_duration_seconds=}")
        done
    fi
    # Backfill reserves exit 2 for partial completion; its caller continues.
    if [[ "$rc" -ne 0 ]] && [[ "$rc" -ne 2 || "$status" != partial ]]; then
        status=failed
        level=error
        event=script_failed
    elif [[ "$status" == partial ]]; then
        level=warning
    elif [[ "${DRY_RUN:-0}" -eq 1 ]]; then
        status=dry_run
    fi
    osm_log "$level" "Script finished" "event=$event" "status=$status" \
        "exit_code=$rc" "step=$_OSM_STEP" \
        "duration_seconds=$((SECONDS - _OSM_SCRIPT_STARTED))" "${OSM_LOG_SUMMARY[@]}" \
        "${resource_fields[@]}"
}

# Suppressed successful command output stays out of the journal; failures retain
# a bounded diagnostic rather than discarding stderr or dumping entire files.
osm_failure_details() {
    local file=$1
    head -c 4096 "$file" 2>/dev/null || true
}

trap 'osm_log_exit "$?"' EXIT

export OSM_LOG_LEVEL="${OSM_LOG_LEVEL:-INFO}"
OSM_LOG_LEVEL=${OSM_LOG_LEVEL^^}
case "$OSM_LOG_LEVEL" in
    DEBUG) _OSM_LOG_THRESHOLD=10 ;;
    INFO) _OSM_LOG_THRESHOLD=20 ;;
    WARNING|WARN) _OSM_LOG_THRESHOLD=30 ;;
    ERROR) _OSM_LOG_THRESHOLD=40 ;;
    *)
        log_error "Invalid OSM_LOG_LEVEL; expected DEBUG, INFO, WARNING, or ERROR" \
            "value=$OSM_LOG_LEVEL"
        exit 1
        ;;
esac
