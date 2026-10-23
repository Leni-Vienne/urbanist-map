"""Resource accounting for pipeline commands and in-process Python phases.

Command records are private temporary data, not log messages. CPU includes waited
descendants; Linux's child maxrss is the largest process peak, not a tree total.
"""

import errno
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time


def peak_rss_bytes(usage):
    return usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024)


def process_snapshot():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    fields = {'cpu_seconds': usage.ru_utime + usage.ru_stime,
              'process_peak_rss_bytes': peak_rss_bytes(usage)}
    try:
        # Current resident pages, unlike ru_maxrss, can decrease between phases.
        fields['rss_bytes'] = int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')
    except (OSError, ValueError, IndexError):
        pass
    return fields


def phase_resources(start, elapsed):
    end = process_snapshot()
    cpu = max(0, end['cpu_seconds'] - start['cpu_seconds'])
    fields = {'cpu_seconds': round(cpu, 6),
              'process_peak_rss_bytes': end['process_peak_rss_bytes']}
    if elapsed > 0:
        fields['avg_cpu_percent'] = round(100 * cpu / elapsed, 2)
    if 'rss_bytes' in start and 'rss_bytes' in end:
        fields.update(rss_start_bytes=start['rss_bytes'], rss_end_bytes=end['rss_bytes'])
    return fields


def record_command(path, command):
    try:
        result = subprocess.run(command)
        code = result.returncode if result.returncode >= 0 else 128 - result.returncode
    except OSError as error:
        print(f'Error: {error}', file=sys.stderr)
        code = 127 if error.errno == errno.ENOENT else 126
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    row = {'cpu_seconds': usage.ru_utime + usage.ru_stime,
           'max_process_rss_bytes': peak_rss_bytes(usage)}
    try:
        # Parallel commands append one small record per write to the same file.
        with open(path, 'a') as output:
            output.write(json.dumps(row) + '\n')
    except OSError as error:
        print(f'Warning: could not record resource usage: {error}', file=sys.stderr)
    return code


def summarize(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines()]
    elapsed = time.perf_counter() - rows[0]['started']
    fields = {'duration_seconds': round(elapsed, 6)}
    commands = rows[1:]
    if commands:
        cpu = sum(row['cpu_seconds'] for row in commands)
        fields.update(cpu_seconds=round(cpu, 6), avg_cpu_percent=round(100 * cpu / elapsed, 2),
                      max_process_rss_bytes=max(row['max_process_rss_bytes'] for row in commands))
    return fields


def main():
    action, *args = sys.argv[1:]
    if action == 'start':
        with tempfile.NamedTemporaryFile(mode='w', prefix='osm-resources-', delete=False) as output:
            output.write(json.dumps({'started': time.perf_counter()}) + '\n')
            print(output.name)
    elif action == 'record':
        raise SystemExit(record_command(args[0], args[1:]))
    elif action == 'summarize':
        for key, value in summarize(args[0]).items():
            print(f'{key}={value}')
    else:
        raise ValueError(f'Unknown resource action: {action}')


if __name__ == '__main__':
    main()
