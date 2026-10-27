import io
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from osm_log import LogfmtFormatter, get_logger, timed_step


SCRIPT_DIR = Path(__file__).resolve().parent


def parse_record(line):
    """Decode the quoted logfmt subset emitted by both implementations."""
    fields = {}
    while line:
        match = re.match(r'(\w+)=', line)
        if not match:
            raise AssertionError(f'Invalid logfmt: {line!r}')
        value, end = json.JSONDecoder().raw_decode(line[match.end():])
        fields[match[1]] = value
        line = line[match.end() + end:].lstrip()
    return fields


class LoggingTest(unittest.TestCase):
    def test_python_log_level_filters_messages(self):
        for level, expected in [('DEBUG', ['debug', 'info', 'warning', 'error']),
                                ('INFO', ['info', 'warning', 'error']),
                                ('WARNING', ['warning', 'error']), ('ERROR', ['error'])]:
            with self.subTest(level=level), patch.dict(os.environ, OSM_LOG_LEVEL=level):
                logger = get_logger(f'osm-test-{level}')
                output = io.StringIO()
                handler = logger.handlers[0]
                handler.setStream(output)
                self.addCleanup(logger.removeHandler, handler)
                for severity in ['debug', 'info', 'warning', 'error']:
                    getattr(logger, severity)('diagnostic')
                self.assertEqual(expected, [parse_record(line)['level']
                                            for line in output.getvalue().splitlines()])

    def test_bash_logs_escape_special_characters_and_keep_stdout_for_data(self):
        message = 'OSM "name" \\ café\nsecond line\ttab\rreturn'
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'worker.sh'
            script.write_text('''set -euo pipefail
source "$1/osm_log.sh"
log_warn "$2" "event=diagnostic"
printf '%s\\n' 'data output'
osm_step_start read
osm_step_end
''')
            result = subprocess.run(['bash', str(script), str(SCRIPT_DIR), message],
                                    capture_output=True, text=True, check=True)
        records = [parse_record(line) for line in result.stderr.splitlines()]
        self.assertEqual('data output\n', result.stdout)
        self.assertEqual(message, records[0]['message'])
        self.assertEqual('warning', records[0]['level'])
        self.assertEqual('worker', records[0]['component'])
        self.assertEqual('step_completed', records[2]['event'])
        self.assertGreaterEqual(float(records[2]['duration_seconds']), 0)
        self.assertEqual('script_completed', records[-1]['event'])
        self.assertEqual(1, len({record['run_id'] for record in records}))

    def test_python_timings_flush_and_failed_steps_have_no_completion_event(self):
        output = io.StringIO()
        logger = logging.Logger('test')
        handler = logging.StreamHandler(output)
        handler.setFormatter(LogfmtFormatter())
        logger.addHandler(handler)
        with patch('osm_log.time.perf_counter', side_effect=[10, 12.345, 20, 21]):
            with timed_step(logger, 'read'):
                # Already visible before the context exits.
                self.assertEqual('step_started', parse_record(output.getvalue().strip())['event'])
            with self.assertRaises(ValueError):
                with timed_step(logger, 'write', traceback=True):
                    raise ValueError('bad "geometry"\nnext line')
        records = [parse_record(line) for line in output.getvalue().splitlines()]
        self.assertEqual(['step_started', 'step_completed', 'step_started', 'step_failed'],
                         [record['event'] for record in records])
        self.assertEqual('2.345', records[1]['duration_seconds'])
        self.assertEqual('error', records[-1]['level'])
        self.assertIn('ValueError', records[-1]['exception'])

    def test_extractor_cli_failures_return_nonzero_and_log_errors(self):
        for script in ['extract_linear_topo.py', 'extract_areal_buildings.py']:
            with self.subTest(script=script), tempfile.TemporaryDirectory() as directory:
                args = []
                if script == 'extract_linear_topo.py':
                    source = Path(directory) / 'empty.osm'
                    source.write_text('<osm version="0.6"></osm>')
                    args = ['--ways-file', str(source), '--source-file', str(source)]
                result = subprocess.run([sys.executable, str(SCRIPT_DIR / script), *args],
                                        cwd=directory, capture_output=True, text=True)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual('', result.stdout)
                records = [parse_record(line) for line in result.stderr.splitlines()]
                self.assertTrue(any(r.get('event') == 'step_failed' and r['level'] == 'error'
                                    for r in records))
                self.assertFalse(any(r.get('event') == 'step_completed' and r['step'] == 'total'
                                     for r in records))
                self.assertEqual(1, sum('exception' in r for r in records))

    def test_extractor_summaries_match_output_without_dumping_feature_names(self):
        source_xml = '''<osm version="0.6">
          <node id="1" lon="2" lat="48"/><node id="2" lon="2.01" lat="48"/>
          <way id="10"><nd ref="1"/><nd ref="2"/>
            <tag k="railway" v="construction"/><tag k="construction" v="rail"/>
            <tag k="name" v="feature-name-for-debugging"/></way></osm>'''
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.osm'
            source.write_text(source_xml)
            output = Path(directory) / 'output.geojson'
            cases = [('extract_linear_topo.py', ['--ways-file', str(source), '--source-file', str(source)]),
                     ('extract_areal_buildings.py', ['--source', str(source)])]
            for script, args in cases:
                with self.subTest(script=script):
                    result = subprocess.run([sys.executable, str(SCRIPT_DIR / script), *args,
                                             '--output', str(output)], capture_output=True, text=True,
                                            env={**os.environ, 'OSM_LOG_LEVEL': 'INFO'})
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertNotIn('feature-name-for-debugging', result.stderr)
                    records = [parse_record(line) for line in result.stderr.splitlines()]
                    summary = next(r for r in records if r.get('event') == 'features_written')
                    self.assertEqual(len(json.loads(output.read_text())['features']), int(summary['features']))
                    self.assertEqual('success', records[-1]['status'])


# Keep the pipeline's filesystem/control flow real; replace only the expensive
# tools and network. All fake commands share one executable to make their output
# deterministic, including the machine-readable state consumed by the script.
FAKE_TOOL = '''#!{python}
import json
import os
from pathlib import Path
import sys
name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == 'df':
    print('Filesystem 1024-blocks Used Available Capacity Mounted on')
    print('test 30000000 1000 29999000 1% /')
elif name == 'curl':
    if '-o' in args:
        Path(args[args.index('-o') + 1]).write_text('diff')
        if '-w' in args:
            print('200', end='')
    else:
        print('sequenceNumber=2\\ntimestamp=2026-10-23T00:00:00Z')
elif name == 'python3':
    if args and args[0].endswith('/osm_resources.py'):
        os.execv(sys.executable, [sys.executable, *args])
    if '-c' not in args:
        if 'extract_linear_topo.py' in args[0] and os.environ.get('FAIL_LINEAR'):
            sys.exit(17)
        Path(args[args.index('--output') + 1]).write_text('geojson')
elif name == 'osmium':
    if args[0] == 'fileinfo':
        print('osmosis_replication_timestamp=2026-10-23T00:00:00Z')
    if args[0] == 'check-refs':
        rc = int(os.environ.get('CHECK_REFS_RC', '0'))
        if rc == 1:
            print('n1 in w10\\nn1 in w11\\nw2 in r20\\nr3 in r20')
        elif rc > 1:
            print('check-refs diagnostic: ' + 'x' * 6000, file=sys.stderr)
        sys.exit(rc)
    if args[0] == 'sort' and os.environ.get('FAIL_SORT'):
        print('sort diagnostic: ' + 'x' * 6000, file=sys.stderr)
        sys.exit(3)
    if '-o' in args:
        Path(args[args.index('-o') + 1]).write_text('pbf')
elif name == 'bun':
    Path(os.environ['IMPORT_ARGS_FILE']).write_text(json.dumps(args))
    print('native importer output')
    if os.environ.get('FAIL_IMPORT'):
        sys.exit(19)
'''


class PipelineLoggingTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        tools = self.work / 'bin'
        tools.mkdir()
        executable = tools / 'tool'
        executable.write_text(FAKE_TOOL.format(python=sys.executable))
        executable.chmod(0o755)
        for name in ['df', 'curl', 'python3', 'osmium', 'bun', 'sleep']:
            (tools / name).symlink_to(executable)
        self.import_args = self.work / 'import-args.json'
        self.env = {**os.environ, 'PATH': f'{tools}:{os.environ["PATH"]}', 'OSM_LOG_LEVEL': 'INFO',
                    'IMPORT_ARGS_FILE': str(self.import_args)}
        self.pbf = self.work / 'test_proposed.osm.pbf'
        self.pbf.write_text('pbf')
        Path(f'{self.pbf}.replication-state').write_text(
            'sequenceNumber=1\ntimestamp=2026-10-22T00:00:00Z\n')

    def run_script(self, script, *args):
        result = subprocess.run(['bash', str(SCRIPT_DIR / script), str(self.pbf), *args],
                                env=self.env, capture_output=True, text=True)
        records = [parse_record(line) for line in result.stderr.splitlines()]
        return result, records

    def test_pipeline_reports_execution_order_and_shared_run_id(self):
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        steps = [r['step'] for r in records
                 if r['component'] == 'update_daily' and r.get('event') == 'step_completed']
        self.assertEqual(['download', 'apply', 'refilter', 'derive', 'backfill', 'extraction', 'import'], steps)
        self.assertEqual(1, len({r['run_id'] for r in records}))
        self.assertTrue(all(r['dry_run'] == '0' for r in records))
        self.assertEqual('native importer output\n', result.stdout)
        self.assertEqual(['run', str(SCRIPT_DIR.parent.parent / 'back/src/scripts/import-osm.ts'),
                          '--input-prefix', str(self.work / 'test_proposed')],
                         json.loads(self.import_args.read_text()))
        self.assertEqual('success', records[-1]['status'])
        self.assertEqual('1', records[-1]['source_sequence'])
        self.assertEqual('2', records[-1]['target_sequence'])
        self.assertEqual('1', records[-1]['diffs'])
        completed = [r for r in records if r['component'] == 'update_daily'
                     and r.get('event') == 'step_completed']
        for record in completed:
            self.assertGreaterEqual(float(record['cpu_seconds']), 0)
            self.assertGreater(float(record['max_process_rss_bytes']), 0)
            self.assertIn('avg_cpu_percent', record)
        # The generated sidecar proves the timestamp was read as data, not logged.
        self.assertIn('timestamp=2026-10-23T00:00:00Z', Path(f'{self.pbf}.replication-state').read_text())

    def test_dry_run_marks_every_event_and_preserves_input(self):
        result, records = self.run_script('update_daily.sh', '--dry-run', '--no-backfill')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue(all(r['dry_run'] == '1' for r in records))
        self.assertEqual('pbf', self.pbf.read_text())
        self.assertFalse((self.work / 'test_proposed_linear.geojson').exists())
        self.assertEqual('dry_run', records[-1]['status'])
        self.assertTrue(all('cpu_seconds' not in r and 'max_process_rss_bytes' not in r
                            for r in records))

    def test_current_dataset_only_reports_the_requested_import(self):
        first, _ = self.run_script('update_daily.sh')
        self.assertEqual(0, first.returncode, first.stderr)
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(['import'], [r['step'] for r in records
                                     if r.get('event') == 'step_completed'])
        self.assertEqual(['--input-prefix', str(self.work / 'test_proposed')],
                         json.loads(self.import_args.read_text())[-2:])

    def test_failed_extractor_prevents_import_and_reports_active_step(self):
        self.env['FAIL_LINEAR'] = '1'
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertNotEqual(0, result.returncode)
        self.assertEqual('script_failed', records[-1]['event'])
        self.assertEqual('extraction', records[-1]['step'])
        self.assertIn('step_duration_seconds', records[-1])
        self.assertGreater(float(records[-1]['cpu_seconds']), 0)
        self.assertNotIn('native importer output', result.stdout)
        self.assertFalse(any(r.get('step') == 'extraction' and r.get('event') == 'step_completed'
                             for r in records))

    def test_backfill_final_report_distinguishes_missing_refs(self):
        # Zero iterations exercises the final report without network or merge work.
        for rc, exit_code, status, level, remaining in [
                (0, 0, 'success', 'info', '0'), (1, 2, 'partial', 'warning', '1')]:
            with self.subTest(rc=rc):
                self.env['CHECK_REFS_RC'] = str(rc)
                result, records = self.run_script('backfill_geometry.sh', '--max-iters', '0')
                self.assertEqual(exit_code, result.returncode, result.stderr)
                report = records[-1]
                self.assertEqual(status, report['status'])
                self.assertEqual(level, report['level'])
                for field in ['remaining_nodes', 'remaining_ways', 'remaining_relations']:
                    self.assertEqual(remaining, report[field])

    def test_partial_backfill_propagates_to_run_outcome_and_still_imports(self):
        self.env['CHECK_REFS_RC'] = '1'
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('partial', records[-1]['status'])
        self.assertEqual('partial', records[-1]['backfill_status'])
        phase = next(r for r in records if r['component'] == 'update_daily'
                     and r.get('step') == 'backfill' and r.get('event') == 'step_completed')
        self.assertEqual('partial', phase['status'])
        self.assertIn('native importer output', result.stdout)

    def test_backfill_check_failure_marks_daily_run_partial_and_still_imports(self):
        self.env['CHECK_REFS_RC'] = '2'
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('partial', records[-1]['status'])
        self.assertEqual('failed', records[-1]['backfill_status'])
        self.assertIn('native importer output', result.stdout)

    def test_fatal_import_failure_overrides_earlier_partial_outcome(self):
        self.env.update(CHECK_REFS_RC='1', FAIL_IMPORT='1')
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertNotEqual(0, result.returncode)
        self.assertEqual('failed', records[-1]['status'])
        self.assertEqual('import', records[-1]['step'])
        self.assertEqual('error', records[-1]['level'])

    def test_sort_failure_retains_bounded_stderr(self):
        self.env.update(CHECK_REFS_RC='1', FAIL_SORT='1')
        result, records = self.run_script('backfill_geometry.sh')
        self.assertEqual(2, result.returncode, result.stderr)
        failures = [r for r in records if r.get('event') == 'sort_failed']
        self.assertTrue(failures)
        for failure in failures:
            self.assertTrue(failure['details'].startswith('sort diagnostic:'))
            self.assertLessEqual(len(failure['details'].encode()), 4096)
            self.assertEqual('3', failure['exit_code'])

    def test_unchanged_run_has_explicit_skips_without_fabricated_durations(self):
        self.run_script('update_daily.sh')
        result, records = self.run_script('update_daily.sh')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('unchanged', records[-1]['status'])
        skipped = [r for r in records if r.get('event') == 'step_skipped']
        self.assertEqual(7, len(skipped))
        self.assertTrue(all('duration_seconds' not in r for r in skipped))

    def test_log_level_hides_batch_details_and_debug_enables_them(self):
        self.env['CHECK_REFS_RC'] = '1'
        _, normal = self.run_script('backfill_geometry.sh', '--dry-run')
        self.assertFalse(any(r['level'] == 'debug' for r in normal))
        self.env['OSM_LOG_LEVEL'] = 'DEBUG'
        _, debug = self.run_script('backfill_geometry.sh', '--dry-run')
        self.assertTrue(any(r['level'] == 'debug' and r['message'] == 'Fetching batch'
                            for r in debug))

    def test_warning_level_keeps_partial_outcome_and_hides_info(self):
        self.env.update(CHECK_REFS_RC='1', OSM_LOG_LEVEL='WARNING')
        result, records = self.run_script('update_daily.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue(all(r['level'] in ['warning', 'error'] for r in records))
        self.assertEqual('partial', records[-1]['status'])
        self.assertIn('native importer output', result.stdout)

    def test_bootstrap_leaves_final_outcome_to_daily_updater(self):
        self.env['CHECK_REFS_RC'] = '1'
        result, records = self.run_script('run_all.sh', '--import')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('update_daily', records[-1]['component'])
        self.assertEqual('partial', records[-1]['status'])
        self.assertFalse(any(r['component'] == 'run_all' and r.get('event') == 'script_completed'
                             for r in records))

    def test_backfill_check_failure_does_not_report_complete_geometry(self):
        self.env['CHECK_REFS_RC'] = '2'
        result, records = self.run_script('backfill_geometry.sh')
        self.assertNotEqual(0, result.returncode)
        self.assertTrue(any('check-refs failed' in r['message'] and r['level'] == 'error'
                            for r in records))
        failure = next(r for r in records if r.get('event') == 'check_refs_failed')
        self.assertTrue(failure['details'].startswith('check-refs diagnostic:'))
        self.assertLessEqual(len(failure['details'].encode()), 4096)
        self.assertEqual('failed', records[-1]['status'])


if __name__ == '__main__':
    unittest.main()
