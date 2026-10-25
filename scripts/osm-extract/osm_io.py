"""GeoJSON output shared by the OSM extractors."""

import json
from contextlib import contextmanager


@contextmanager
def feature_collection_writer(output):
    """Yield a feature sink that encodes and writes one feature at a time."""
    with open(output, 'w', encoding='utf-8') as stream:
        stream.write('{"type":"FeatureCollection","features":[')
        first = True

        def write_feature(feature):
            nonlocal first
            encoded = json.dumps(feature, ensure_ascii=False, separators=(',', ':'))
            if not first:
                stream.write(',')
            stream.write(encoded)
            first = False

        yield write_feature
        stream.write(']}')


def write_feature_collection(features, output):
    """Use the C JSON encoder, buffering at most one encoded feature at a time."""
    with feature_collection_writer(output) as write_feature:
        for feature in features:
            write_feature(feature)
