import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from osm_resources import phase_resources, summarize


HELPER = Path(__file__).with_name('osm_resources.py')


class ResourceAccountingTest(unittest.TestCase):
    def test_summary_sums_cpu_but_takes_largest_process_memory_peak(self):
        with tempfile.NamedTemporaryFile(mode='w') as output:
            for row in [{'started': 10}, {'cpu_seconds': 5, 'max_process_rss_bytes': 100},
                        {'cpu_seconds': 7, 'max_process_rss_bytes': 200}]:
                output.write(json.dumps(row) + '\n')
            output.flush()
            with patch('osm_resources.time.perf_counter', return_value=20):
                fields = summarize(output.name)
        self.assertEqual(10, fields['duration_seconds'])
        self.assertEqual(12, fields['cpu_seconds'])
        self.assertEqual(120, fields['avg_cpu_percent'])
        self.assertEqual(200, fields['max_process_rss_bytes'])

    def test_python_phase_reports_cpu_delta_and_current_rss_separately_from_lifetime_peak(self):
        start = {'cpu_seconds': 10, 'rss_bytes': 200, 'process_peak_rss_bytes': 300}
        end = {'cpu_seconds': 13, 'rss_bytes': 100, 'process_peak_rss_bytes': 300}
        with patch('osm_resources.process_snapshot', return_value=end):
            fields = phase_resources(start, 2)
        self.assertEqual(3, fields['cpu_seconds'])
        self.assertEqual(150, fields['avg_cpu_percent'])
        self.assertEqual(200, fields['rss_start_bytes'])
        self.assertEqual(100, fields['rss_end_bytes'])
        self.assertEqual(300, fields['process_peak_rss_bytes'])

    def test_parallel_records_include_cpu_and_memory_of_waited_grandchildren(self):
        # Each command waits for a CPU/memory-consuming grandchild. The two
        # independent recorders append concurrently to a shared phase file.
        work = '''import time
payload = bytearray(24 * 1024 * 1024)
started = time.process_time()
while time.process_time() - started < 0.08:
    pass
'''
        parent = f'import subprocess, sys; subprocess.run([sys.executable, "-c", {work!r}], check=True)'
        path = subprocess.check_output([sys.executable, str(HELPER), 'start'], text=True).strip()
        self.addCleanup(os.unlink, path)
        workers = [subprocess.Popen([sys.executable, str(HELPER), 'record', path,
                                     sys.executable, '-c', parent]) for _ in range(2)]
        for worker in workers:
            self.assertEqual(0, worker.wait(timeout=20))
        rows = Path(path).read_text().splitlines()
        self.assertEqual(3, len(rows))
        fields = summarize(path)
        self.assertGreaterEqual(fields['cpu_seconds'], 0.16)
        self.assertGreaterEqual(fields['max_process_rss_bytes'], 24 * 1024 * 1024)
        self.assertGreater(fields['avg_cpu_percent'], 0)

    def test_failed_command_keeps_its_exit_code_and_resources(self):
        path = subprocess.check_output([sys.executable, str(HELPER), 'start'], text=True).strip()
        self.addCleanup(os.unlink, path)
        result = subprocess.run([sys.executable, str(HELPER), 'record', path,
                                 sys.executable, '-c', 'raise SystemExit(17)'])
        self.assertEqual(17, result.returncode)
        self.assertIn('cpu_seconds', summarize(path))
        self.assertGreater(summarize(path)['max_process_rss_bytes'], 0)

    def test_launch_errors_preserve_shell_exit_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            blocked = Path(directory) / 'not-executable'
            blocked.write_text('cannot execute')
            for command, expected in [(str(blocked), 126), (str(blocked) + '-missing', 127)]:
                with self.subTest(command=command):
                    path = subprocess.check_output([sys.executable, str(HELPER), 'start'], text=True).strip()
                    self.addCleanup(os.unlink, path)
                    result = subprocess.run([sys.executable, str(HELPER), 'record', path, command],
                                            capture_output=True, text=True)
                    self.assertEqual(expected, result.returncode)
                    self.assertIn('Error:', result.stderr)


if __name__ == '__main__':
    unittest.main()
