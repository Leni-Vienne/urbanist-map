"""GeoJSON output shared by the OSM extractors."""

import json


def write_feature_collection(features, output):
    """Use the C JSON encoder, buffering at most one encoded feature at a time."""
    with open(output, 'w', encoding='utf-8') as stream:
        stream.write('{"type":"FeatureCollection","features":[')
        for i, feature in enumerate(features):
            if i:
                stream.write(',')
            stream.write(json.dumps(feature, ensure_ascii=False, separators=(',', ':')))
        stream.write(']}')
