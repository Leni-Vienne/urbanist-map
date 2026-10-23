"""Standard-library logging with the same logfmt fields as the Bash scripts."""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import logging
import os
import time
import uuid

from osm_resources import phase_resources, process_snapshot


class LogfmtFormatter(logging.Formatter):
    def format(self, record):
        fields = {
            'time': datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            'level': record.levelname.lower(),
            'component': record.name,
            'run_id': os.environ.get('OSM_RUN_ID', ''),
            'dry_run': '0',
            'message': record.getMessage(),
            **getattr(record, 'fields', {}),
        }
        if record.exc_info:
            fields['exception'] = self.formatException(record.exc_info)
        return ' '.join(f'{key}={json.dumps(str(value), ensure_ascii=False)}'
                        for key, value in fields.items())


def get_logger(component):
    if not os.environ.get('OSM_RUN_ID'):
        os.environ['OSM_RUN_ID'] = uuid.uuid4().hex
    logger = logging.getLogger(component)
    if not logger.handlers:
        handler = logging.StreamHandler()  # stderr, flushed after every record
        handler.setFormatter(LogfmtFormatter())
        logger.addHandler(handler)
        level = os.environ.get('OSM_LOG_LEVEL', 'INFO').upper()
        if level not in ('DEBUG', 'INFO', 'WARNING', 'WARN', 'ERROR'):
            logger.error('Invalid OSM_LOG_LEVEL; expected DEBUG, INFO, WARNING, or ERROR')
            raise SystemExit(1)
        logger.setLevel(level)
        logger.propagate = False
    return logger


@contextmanager
def timed_step(logger, step, *, traceback=False, **fields):
    started = time.perf_counter()
    usage = process_snapshot()
    logger.info('Starting step', extra={'fields': {
        'event': 'step_started', 'step': step, **fields,
    }})
    try:
        yield
    except Exception as error:
        elapsed = time.perf_counter() - started
        # Inner stages identify the failure; the outer total emits its traceback once.
        logger.error('Step failed: %s', error, exc_info=traceback, extra={'fields': {
            'event': 'step_failed', 'step': step, 'status': 'failed',
            'duration_seconds': round(elapsed, 3), **phase_resources(usage, elapsed),
        }})
        raise
    else:
        elapsed = time.perf_counter() - started
        logger.info('Finished step', extra={'fields': {
            'event': 'step_completed', 'step': step, 'status': 'success',
            'duration_seconds': round(elapsed, 3), **phase_resources(usage, elapsed),
        }})
