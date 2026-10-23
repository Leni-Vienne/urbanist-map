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
import time
from datetime import datetime
from shapely.geometry import mapping, Polygon
from shapely.strtree import STRtree

from osm_io import write_feature_collection
from osm_policy import (
    classify_areal_feature,
    get_areal_building_category,
    get_areal_project_status,
    has_identity,
    passes_areal_size_gate,
)


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
    def __init__(self):
        super().__init__()
        self.wkbfab = osmium.geom.WKBFactory()
        self.features = []
        self.geometries = {}  # feature_id -> shapely geometry, for containment checks

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

        self.features.append({
            'type': 'Feature',
            'id': feature_id,
            'geometry': mapping(geom),
            'properties': props
        })
        self.geometries[feature_id] = geom


def filter_nested_buildings(features, geometries):
    """
    Remove redundant unidentified container polygons:
    - A large area with no identifying tags (name, wikidata, description, website) that
      contains smaller buildings is removed, keeping the individual buildings inside.
    - An identified area (a development) is kept alongside the buildings within it, so
      individually-mapped buildings are never hidden under a development boundary.

    Returns (filtered_features, stats_dict).
    """
    buildings = [f for f in features if f['properties'].get('transport_type') == 'building']
    non_buildings = [f for f in features if f['properties'].get('transport_type') != 'building']

    if len(buildings) < 2:
        return features, {'checked': 0, 'removed_containers': 0}

    # Build spatial index
    building_geoms = []
    building_map = {}  # geom index -> feature
    for f in buildings:
        fid = f['id']
        if fid in geometries:
            idx = len(building_geoms)
            building_geoms.append(geometries[fid])
            building_map[idx] = f

    if not building_geoms:
        return features, {'checked': 0, 'removed_containers': 0}

    tree = STRtree(building_geoms)

    to_remove = set()
    removed_containers = 0

    for i, geom in enumerate(building_geoms):
        if i in to_remove:
            continue

        feature = building_map[i]
        props = feature['properties']
        identified = has_identity(props)
        area = props.get('area_sqm', 0)

        candidates = tree.query(geom)

        for j in candidates:
            if i == j or j in to_remove:
                continue

            other_feature = building_map[j]
            other_area = other_feature['properties'].get('area_sqm', 0)
            other_geom = building_geoms[j]

            # Only an unidentified container is removed (keeping the smaller buildings inside
            # it). An identified area is kept alongside the buildings within it. The case where
            # j is the larger container is handled when j is itself processed as i.
            if area > other_area * 1.5 and not identified:  # i is an unidentified container of j
                if geom.contains(other_geom.centroid):
                    to_remove.add(i)
                    removed_containers += 1
                    break  # this container is removed, stop checking

    kept_buildings = [building_map[i] for i in range(len(building_geoms)) if i not in to_remove]

    stats = {
        'checked': len(buildings),
        'removed_containers': removed_containers
    }
    
    return non_buildings + kept_buildings, stats


def _fmt(secs):
    return f"{int(secs // 60)}m{int(secs % 60):02d}s"


def _ts():
    return datetime.now().strftime('%H:%M:%S')


def main():
    args = _parse_args()
    SOURCE_FILE = args.source
    OUTPUT_FILE = args.output
    t_total = time.time()

    print(f"[areal] [{_ts()}] Reading geometries from {SOURCE_FILE}...")
    t = time.time()
    handler = ArealExtractionHandler()
    try:
        # locations=True feeds node coordinates to the way() callback for unclosed area-tagged ways.
        handler.apply_file(SOURCE_FILE, locations=True)
    except Exception as e:
        print(f"[areal] [{_ts()}] Error reading file: {e}")
        return
    print(f"[areal] [{_ts()}] Read done in {_fmt(time.time() - t)}, {len(handler.features):,} features found")

    print(f"\n[areal] [{_ts()}] Filtering nested buildings...")
    t = time.time()
    features, nest_stats = filter_nested_buildings(handler.features, handler.geometries)
    print(f"[areal] [{_ts()}] Nesting filter done in {_fmt(time.time() - t)}")
    print(f"  Checked: {nest_stats['checked']:,} buildings")
    print(f"  Removed unidentified containers: {nest_stats['removed_containers']:,}")
    print(f"  Kept: {len(features):,}")

    print(f"\n[areal] [{_ts()}] Writing {OUTPUT_FILE}...")
    t = time.time()
    write_feature_collection(features, OUTPUT_FILE)
    print(f"[areal] [{_ts()}] Write done in {_fmt(time.time() - t)}")

    print("\n[areal] Sample features:")
    for feature in features[:10]:
        props = feature['properties']
        name = (props.get('display_name') or 'Unnamed')[:50]
        area = props.get('area_sqm', 0)
        transport = props.get('transport_type', '?')
        print(f"  [{transport:10s}] {area:6,d} m² | {name}")

    print(f"\n[areal] [{_ts()}] Done! Total: {_fmt(time.time() - t_total)}")

if __name__ == '__main__':
    main()
