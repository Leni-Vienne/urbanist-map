from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest

from osm_io import write_feature_collection


class FeatureCollectionWriterTest(unittest.TestCase):
    def test_matches_streaming_json_encoding_including_unicode_and_coordinates(self):
        features = [{
            'type': 'Feature',
            'id': 'way/9007199254740993',
            'geometry': {'type': 'LineString', 'coordinates': [(2.0, -0.0), (1e-12, 1e20)]},
            'properties': {'name': 'Ångström — 地図', 'description': 'quote " slash \\ newline\n'},
        }]
        for values in [[], features, features * 2]:
            with self.subTest(features=len(values)):
                expected = StringIO()
                json.dump({'type': 'FeatureCollection', 'features': values}, expected,
                          ensure_ascii=False, separators=(',', ':'))
                with tempfile.TemporaryDirectory() as directory:
                    output = Path(directory) / 'features.geojson'
                    write_feature_collection(values, output)
                    self.assertEqual(expected.getvalue().encode('utf-8'), output.read_bytes())

    def test_accepts_a_single_pass_feature_iterator(self):
        features = [{'type': 'Feature', 'geometry': None, 'properties': {'i': i}}
                    for i in range(3)]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'features.geojson'
            write_feature_collection((feature for feature in features), output)
            self.assertEqual({'type': 'FeatureCollection', 'features': features},
                             json.loads(output.read_text()))


if __name__ == '__main__':
    unittest.main()
