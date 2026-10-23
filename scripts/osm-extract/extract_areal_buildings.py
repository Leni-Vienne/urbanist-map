#!/usr/bin/env python3
"""
Extract proposed/construction large buildings and landuse areas from OSM.

This script parses areal geometries (polygons/multipolygons), calculates their
approximate surface area, and filters out single-family homes or small structures
to retain only large urban developments, commercial centers, and apartment complexes.
"""

import osmium
import osmium.geom
import shapely.wkb
import math
import re
import argparse
from shapely.geometry import mapping, Polygon

from osm_log import get_logger, timed_step
from osm_io import write_feature_collection
from osm_policy import (
    classify_areal_feature,
    get_areal_building_category,
    get_areal_project_status,
    passes_areal_size_gate,
)


LOGGER = get_logger('areal')


def _parse_args():
    parser = argparse.ArgumentParser(description='Extract proposed/construction areal features from OSM.')
    parser.add_argument('--source', default='planet-latest_proposed_areal.osm.pbf',
                        help='Filtered areal PBF file')
    parser.add_argument('--output', default='planet-latest_proposed_areal.geojson',
                        help='Output GeoJSON file path')
    return parser.parse_args()


URL_RE = re.compile(r'https?://\S+')


def clean_description(desc):
    """Strip URLs from a description string. Returns (cleaned_text, first_url_or_None)."""
    urls = URL_RE.findall(desc)
    clean = URL_RE.sub('', desc)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean, (urls[0] if urls else None)

def create_display_name(props):
    name = props.get('name', '').strip()
    if name:
        return name

    desc = props.get('description', '').strip()
    if desc:
        cleaned, _ = clean_description(desc)
        cleaned = re.sub(r'\s*\([^)]*\)\s*$', '', cleaned).strip()
        if cleaned:
            return cleaned

    return None


class ArealExtractionHandler(osmium.SimpleHandler):
    def __init__(self, defer_geometry=False):
        super().__init__()
        self.wkbfab = osmium.geom.WKBFactory()
        self.defer_geometry = defer_geometry
        self.features = []

    def area(self, a):
        tags = {t.k: t.v for t in a.tags}
        kind = classify_areal_feature(tags)
        if kind is None:
            return

        try:
            wkb = self.wkbfab.create_multipolygon(a)
            geom = shapely.wkb.loads(wkb, hex=True)
        except Exception:
            return

        # Pyosmium prefixes area ids: 1 for ways, 2 for relations; a.orig_id() gives the true OSM ID.
        feature_id = f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"
        timestamp = a.timestamp.isoformat() if hasattr(a, 'timestamp') and a.timestamp else None
        self.emit_feature(tags, kind, geom, feature_id, timestamp)

    def way(self, w):
        # Closed ways reach the area callback; this catches area-tagged ways left unclosed
        # (e.g. landuse=construction on an open ring) by closing them into a polygon.
        if w.is_closed():
            return
        tags = {t.k: t.v for t in w.tags}
        kind = classify_areal_feature(tags)
        if kind is None:
            return
        try:
            coords = [(n.location.lon, n.location.lat) for n in w.nodes if n.location.valid()]
        except Exception:
            return
        if len(coords) < 3:
            return
        geom = Polygon(coords)
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.is_empty:
            return
        timestamp = w.timestamp.isoformat() if w.timestamp else None
        self.emit_feature(tags, kind, geom, f"way/{w.id}", timestamp)

    def emit_feature(self, tags, kind, geom, feature_id, timestamp):
        lat = geom.centroid.y
        area_m2 = geom.area * (111320**2) * math.cos(math.radians(lat))
        category = get_areal_building_category(tags)
        if not passes_areal_size_gate(tags, kind, category, area_m2):
            return

        props = dict(tags)
        props['transport_type'] = kind
        if kind == 'building' and category:
            props['building_category'] = category
        props['project_status'] = get_areal_project_status(tags)

        props['display_name'] = create_display_name(props)

        # Clean URLs from description
        desc = props.get('description', '')
        if desc and URL_RE.search(desc):
            clean, url = clean_description(desc)
            props['description'] = clean
            if url and not props.get('source', '').strip():
                props['source'] = url

        props['osm_ids'] = [feature_id]
        props['area_sqm'] = round(area_m2)
        if timestamp:
            props['osm_last_modified'] = timestamp

        # Production keeps the Shapely shape until output. Eager mapping() here
        # retains Python coordinate objects for every feature at once; streaming
        # conversion saved about 747 MiB of peak RAM on the production PBF.
        self.features.append({
            'type': 'Feature',
            'id': feature_id,
            'geometry': geom if self.defer_geometry else mapping(geom),
            'properties': props
        })


def main():
    args = _parse_args()
    SOURCE_FILE = args.source
    OUTPUT_FILE = args.output

    with timed_step(LOGGER, 'read', input=str(SOURCE_FILE)):
        handler = ArealExtractionHandler(defer_geometry=True)
        # locations=True feeds coordinates to way() for unclosed area-tagged ways.
        handler.apply_file(SOURCE_FILE, locations=True)
    LOGGER.info("Read geometries", extra={"fields": {"event": "geometry_read", "features": len(handler.features)}})

    with timed_step(LOGGER, 'write', output=str(OUTPUT_FILE)):
        # Keep this a generator: convert and write one feature at a time. A list
        # comprehension or conversion during reading would undo the RAM saving.
        # Use each feature's own shape; repeated IDs can have different shapes.
        encoded = ({**feature, 'geometry': mapping(feature['geometry'])}
                   for feature in handler.features)
        write_feature_collection(encoded, OUTPUT_FILE)

    LOGGER.info("Wrote GeoJSON", extra={'fields': {
        'event': 'features_written', 'output': str(OUTPUT_FILE),
        'features_read': len(handler.features), 'features': len(handler.features),
    }})


if __name__ == '__main__':
    try:
        with timed_step(LOGGER, 'total', traceback=True):
            main()
    except Exception:
        raise SystemExit(1)
