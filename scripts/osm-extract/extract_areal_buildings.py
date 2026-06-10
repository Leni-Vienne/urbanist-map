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
import shapely.prepared
import math
import json
import re
import argparse
import time
from collections import defaultdict
from datetime import datetime
from shapely.geometry import mapping, shape

def _parse_args():
    parser = argparse.ArgumentParser(description='Extract proposed/construction areal features from OSM.')
    parser.add_argument('--source', default='planet-latest_proposed_areal.osm.pbf',
                        help='Filtered areal PBF file')
    parser.add_argument('--output', default='planet-latest_proposed_areal.geojson',
                        help='Output GeoJSON file path')
    return parser.parse_args()

_args = _parse_args()
SOURCE_FILE = _args.source
OUTPUT_FILE = _args.output

URL_RE = re.compile(r'https?://\S+')

# Tags that indicate small/residential structures filtered out by type regardless of area.
EXCLUDE_BUILDINGS = {
    'house', 'detached', 'semidetached_house', 'garage', 'garages',
    'shed', 'hut', 'cabin', 'roof', 'terrace', 'carport'
}

# Building/landuse types that mark a definite non-house development. These get a lower area
# floor; generic untyped construction keeps the higher floor since it is more likely a house.
NONHOUSE_TYPES = {
    'apartments', 'commercial', 'office', 'retail', 'industrial', 'hospital', 'school',
    'hotel', 'university', 'warehouse', 'public', 'civic', 'college', 'kindergarten',
    'church', 'dormitory', 'clinic', 'sports_centre', 'train_station', 'transportation',
    'education', 'government', 'farm'
}


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
        
        building = tags.get('building', '')
        landuse = tags.get('landuse', '')
        leisure = tags.get('leisure', '')
        construction = tags.get('construction', '')
        proposed = tags.get('proposed', '')
        planned = tags.get('planned', '')
        proposed_building = tags.get('proposed:building', '')
        planned_building = tags.get('planned:building', '')
        construction_building = tags.get('construction:building', '')
        proposed_landuse = tags.get('proposed:landuse', '')
        planned_landuse = tags.get('planned:landuse', '')
        construction_landuse = tags.get('construction:landuse', '')

        park_values = ('park', 'garden', 'playground', 'recreation_ground')
        is_park_construction = (
            leisure in ('park', 'garden', 'playground', 'recreation_ground', 'sports_centre') and
            (construction or proposed or planned)
        ) or (
            construction in park_values or
            proposed in park_values or
            planned in park_values
        )

        is_building_construction = (
            building in ('construction', 'proposed', 'planned') or
            landuse == 'construction' or
            construction in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            proposed in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            planned in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            (proposed_building and proposed_building != 'no') or
            (planned_building and planned_building != 'no') or
            (construction_building and construction_building != 'no') or
            proposed_landuse in ('construction', 'residential', 'commercial', 'retail', 'industrial') or
            planned_landuse in ('construction', 'residential', 'commercial', 'retail', 'industrial') or
            construction_landuse in ('construction', 'residential', 'commercial', 'retail', 'industrial') or
            (proposed and proposed != 'no') or
            (planned and planned != 'no')
        )

        if not is_park_construction and not is_building_construction:
            return

        # Exclude small residential building types
        target_use = tags.get('construction', tags.get('construction:building', tags.get('proposed', tags.get('planned', tags.get('proposed:building', tags.get('planned:building', tags.get('building:use', '')))))))
        if target_use in EXCLUDE_BUILDINGS:
            return

        # Exclude roadworks/transport infrastructure mapped as polygons
        infrastructure_keys = {'highway', 'railway', 'aeroway', 'waterway', 'power', 'telecom', 'public_transport'}
        if any(k in tags for k in infrastructure_keys):
            return

        # Exclude features where construction/proposed value is a transport infrastructure type.
        # With landuse=construction or a building tag, the value names the future land use
        # (e.g. construction=residential -> landuse=residential), not a road class, so keep it.
        infrastructure_values = {
            'tram', 'rail', 'railway', 'light_rail', 'subway', 'narrow_gauge', 'train',
            'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
            'cycleway', 'footway', 'pedestrian', 'path', 'track', 'road', 'bridge', 'tunnel'
        }
        has_areal_context = landuse == 'construction' or building != '' or proposed_building != '' or planned_building != '' or construction_building != '' or proposed_landuse != '' or planned_landuse != '' or construction_landuse != ''
        if not has_areal_context and (tags.get('construction') in infrastructure_values or tags.get('proposed') in infrastructure_values):
            return

        try:
            wkb = self.wkbfab.create_multipolygon(a)
            geom = shapely.wkb.loads(wkb, hex=True)
        except Exception:
            return

        lat = geom.centroid.y
        area_m2 = geom.area * (111320**2) * math.cos(math.radians(lat))

        # A definite development (clear non-house type, or a landuse=construction area) uses a
        # lower size floor; generic untyped construction keeps the higher floor to drop houses.
        has_nonhouse_signal = (
            building in NONHOUSE_TYPES or construction in NONHOUSE_TYPES or
            proposed in NONHOUSE_TYPES or planned in NONHOUSE_TYPES or
            proposed_building in NONHOUSE_TYPES or planned_building in NONHOUSE_TYPES or
            construction_building in NONHOUSE_TYPES or
            landuse == 'construction' or
            landuse in ('commercial', 'retail', 'industrial', 'residential') or
            proposed_landuse in ('construction', 'commercial', 'retail', 'industrial', 'residential') or
            planned_landuse in ('construction', 'commercial', 'retail', 'industrial', 'residential') or
            construction_landuse in ('construction', 'commercial', 'retail', 'industrial', 'residential')
        )

        if is_park_construction:
            if area_m2 < 200:
                return
            feature_kind = 'park'
        else:
            if area_m2 < (200 if has_nonhouse_signal else 400):
                return
            feature_kind = 'building'

        props = dict(tags)
        props['transport_type'] = feature_kind

        # construction= is the strongest signal, check it first
        if construction and construction not in ('yes', 'no'):
            status_check = 'under_construction'
        elif building == 'construction' or tags.get('landuse') == 'construction' or (construction_building and construction_building != 'no') or construction_landuse:
            status_check = 'under_construction'
        elif building == 'proposed' or (proposed and proposed != 'no') or (proposed_building and proposed_building != 'no') or proposed_landuse:
            status_check = 'proposed'
        elif building == 'planned' or (planned and planned != 'no') or (planned_building and planned_building != 'no') or planned_landuse:
            status_check = 'planned'
        else:
            status_check = 'under_construction'
        props['project_status'] = status_check

        props['display_name'] = create_display_name(props)

        # Clean URLs from description
        desc = props.get('description', '')
        if desc and URL_RE.search(desc):
            clean, url = clean_description(desc)
            props['description'] = clean
            if url and not props.get('source', '').strip():
                props['source'] = url

        # Pyosmium prefixes area ids: 1 for ways, 2 for relations; a.orig_id() gives the true OSM ID.
        feature_id = f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"
        props['osm_ids'] = [feature_id]
        props['area_sqm'] = round(area_m2)
        if hasattr(a, 'timestamp') and a.timestamp:
            props['osm_last_modified'] = a.timestamp.isoformat()

        self.features.append({
            'type': 'Feature',
            'id': feature_id,
            'geometry': mapping(geom),
            'properties': props
        })
        self.geometries[feature_id] = geom


def filter_nested_buildings(features, geometries):
    """
    Remove redundant unnamed container polygons:
    - A large area with NO name that contains smaller buildings is removed, keeping the
      individual buildings inside.
    - A named area (a development) is kept alongside the buildings within it, so
      individually-mapped buildings are never hidden under a development boundary.

    Returns (filtered_features, stats_dict).
    """
    from shapely.strtree import STRtree
    
    buildings = [f for f in features if f['properties'].get('transport_type') == 'building']
    non_buildings = [f for f in features if f['properties'].get('transport_type') != 'building']
    
    if len(buildings) < 2:
        return features, {'checked': 0, 'removed_unnamed_containers': 0}
    
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
        return features, {'checked': 0, 'removed_unnamed_containers': 0}
    
    tree = STRtree(building_geoms)

    to_remove = set()
    removed_unnamed_containers = 0

    for i, geom in enumerate(building_geoms):
        if i in to_remove:
            continue
            
        feature = building_map[i]
        fid = feature['id']
        props = feature['properties']
        has_name = bool(props.get('name', '').strip())
        area = props.get('area_sqm', 0)
        
        candidates = tree.query(geom)

        for j in candidates:
            if i == j or j in to_remove:
                continue
                
            other_feature = building_map[j]
            other_area = other_feature['properties'].get('area_sqm', 0)
            other_geom = building_geoms[j]

            # Only an unnamed container is removed (keeping the smaller buildings inside it).
            # A named area is kept alongside the buildings within it. The case where j is the
            # larger container is handled when j is itself processed as i.
            if area > other_area * 1.5 and not has_name:  # i is an unnamed container of j
                if geom.contains(other_geom.centroid):
                    to_remove.add(i)
                    removed_unnamed_containers += 1
                    break  # this container is removed, stop checking
    
    # Build filtered list
    kept_buildings = [building_map[i] for i in range(len(building_geoms)) if i not in to_remove]
    
    stats = {
        'checked': len(buildings),
        'removed_unnamed_containers': removed_unnamed_containers
    }
    
    return non_buildings + kept_buildings, stats


def _fmt(secs):
    return f"{int(secs // 60)}m{int(secs % 60):02d}s"


def _ts():
    return datetime.now().strftime('%H:%M:%S')


def main():
    t_total = time.time()

    print(f"[areal] [{_ts()}] Reading geometries from {SOURCE_FILE}...")
    t = time.time()
    handler = ArealExtractionHandler()
    try:
        handler.apply_file(SOURCE_FILE)
    except Exception as e:
        print(f"[areal] [{_ts()}] Error reading file: {e}")
        return
    print(f"[areal] [{_ts()}] Read done in {_fmt(time.time() - t)}, {len(handler.features):,} features found")

    print(f"\n[areal] [{_ts()}] Filtering nested buildings...")
    t = time.time()
    features, nest_stats = filter_nested_buildings(handler.features, handler.geometries)
    print(f"[areal] [{_ts()}] Nesting filter done in {_fmt(time.time() - t)}")
    print(f"  Checked: {nest_stats['checked']:,} buildings")
    print(f"  Removed unnamed containers: {nest_stats['removed_unnamed_containers']:,}")
    print(f"  Kept: {len(features):,}")

    print(f"\n[areal] [{_ts()}] Writing {OUTPUT_FILE}...")
    t = time.time()
    collection = {'type': 'FeatureCollection', 'features': features}
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(collection, f, ensure_ascii=False, separators=(',', ':'))
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
