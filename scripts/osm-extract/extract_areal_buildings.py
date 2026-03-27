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
from datetime import datetime, timedelta, timezone
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

# Features not modified in OSM for longer than this are filtered out (unless named)
STALE_THRESHOLD_YEARS = 3

URL_RE = re.compile(r'https?://\S+')

# Tags that typically indicate a trivial/small building, even if large,
# we might want to skip them if they are just sheds. But we rely primarily on area.
EXCLUDE_BUILDINGS = {
    'house', 'detached', 'semidetached_house', 'garage', 'garages',
    'shed', 'hut', 'cabin', 'roof', 'terrace', 'carport'
}


# ---------------------------------------------------------------------------
# Date filtering helpers
# ---------------------------------------------------------------------------

def get_stale_threshold():
    """Return the datetime threshold for stale features."""
    return datetime.now(timezone.utc) - timedelta(days=STALE_THRESHOLD_YEARS * 365)

def is_stale_timestamp(timestamp_str, threshold):
    """Check if a timestamp string is older than the threshold."""
    if not timestamp_str:
        return False  # Can't determine age, keep it
    try:
        # Handle ISO format with or without timezone
        ts_str = timestamp_str.replace('Z', '+00:00')
        ts = datetime.fromisoformat(ts_str)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts < threshold
    except Exception:
        return False  # Can't parse, keep it

def has_name_tag(props):
    """Check if props contain a name (keeps feature regardless of age)."""
    return bool(props.get('name', '').strip())

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
        self.geometries = {}  # Store shapely geometries by feature id for containment check

    def area(self, a):
        tags = {t.k: t.v for t in a.tags}
        
        building = tags.get('building', '')
        landuse = tags.get('landuse', '')
        leisure = tags.get('leisure', '')
        construction = tags.get('construction', '')
        proposed = tags.get('proposed', '')
        planned = tags.get('planned', '')

        # Determine if this is a park/green space under construction or planned
        is_park_construction = (
            leisure in ('park', 'garden', 'playground', 'recreation_ground', 'sports_centre') and
            (construction or proposed or planned or tags.get('state') in ('construction', 'proposed', 'planned'))
        )

        # Determine if this is a building/development under construction or planned
        is_building_construction = (
            building in ('construction', 'proposed', 'planned') or
            landuse in ('construction', 'planned') or
            construction in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            proposed in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            planned in ('apartments', 'commercial', 'office', 'industrial', 'retail', 'yes') or
            tags.get('planned:building') or
            tags.get('state') == 'construction'
        )

        if not is_park_construction and not is_building_construction:
            return

        # Fast exclusion of obviously small residential stuff based on target tag
        target_use = tags.get('construction', tags.get('proposed', tags.get('planned', tags.get('building:use', ''))))
        if target_use in EXCLUDE_BUILDINGS:
            return

        try:
            wkb = self.wkbfab.create_multipolygon(a)
            geom = shapely.wkb.loads(wkb, hex=True)
        except Exception:
            return

        # Calculate approximate area in square meters
        lat = geom.centroid.y
        area_m2 = geom.area * (111320**2) * (math.cos(math.radians(lat))**2)

        # Determine transport_type and apply size thresholds
        if is_park_construction:
            # Parks can be smaller
            if area_m2 < 200:
                return
            transport_type = 'park'
        else:
            # Buildings/development areas need to be larger
            if area_m2 < 400:
                return
            transport_type = 'building'

        # Build feature properties
        props = dict(tags)
        props['transport_type'] = transport_type
        
        status_check = 'under_construction'
        if building == 'proposed' or landuse == 'proposed' or tags.get('state') == 'proposed':
            status_check = 'proposed'
        elif building == 'planned' or landuse == 'planned' or tags.get('state') == 'planned' or (planned and not construction):
            status_check = 'planned'
        props['project_status'] = status_check
        
        props['display_name'] = create_display_name(props)

        # Clean URLs from description
        desc = props.get('description', '')
        if desc and URL_RE.search(desc):
            clean, url = clean_description(desc)
            props['description'] = clean
            if url and not props.get('source', '').strip():
                props['source'] = url

        # Exclude roadworks/transport infrastructure mapped as polygons
        # A robust fix relies on infrastructure tags rather than localized names.
        infrastructure_keys = {'highway', 'railway', 'aeroway', 'waterway', 'power', 'telecom', 'public_transport'}
        if any(k in tags for k in infrastructure_keys):
            return
            
        # Check if the construction/proposed type is a transport infrastructure type
        # rather than a building/landuse type.
        infrastructure_values = {
            'tram', 'rail', 'railway', 'light_rail', 'subway', 'narrow_gauge', 'train',
            'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
            'cycleway', 'footway', 'pedestrian', 'path', 'track', 'road', 'bridge', 'tunnel'
        }
        if tags.get('construction') in infrastructure_values or tags.get('proposed') in infrastructure_values:
            return

        # Create geojson feature
        # Pyosmium prefixes area ids with 1 (way) or 2 (relation). 
        # a.orig_id() gives the true OSM ID.
        feature_id = f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"
        props['osm_ids'] = [feature_id]
        props['area_sqm'] = round(area_m2)
        
        # Extract last modified date from OSM
        if hasattr(a, 'timestamp') and a.timestamp:
            props['osm_last_modified'] = a.timestamp.isoformat()

        self.features.append({
            'type': 'Feature',
            'id': feature_id,
            'geometry': mapping(geom),
            'properties': props
        })
        
        # Store geometry for containment check
        self.geometries[feature_id] = geom


def filter_nested_buildings(features, geometries):
    """
    Filter out redundant nested buildings based on naming:
    - If a large area HAS a name → keep only the large area, remove buildings inside
    - If a large area has NO name → remove the large area, keep individual buildings inside
    
    Returns (filtered_features, stats_dict).
    """
    from shapely.strtree import STRtree
    
    # Only process buildings (not parks)
    buildings = [f for f in features if f['properties'].get('transport_type') == 'building']
    non_buildings = [f for f in features if f['properties'].get('transport_type') != 'building']
    
    if len(buildings) < 2:
        return features, {'checked': 0, 'removed_unnamed_containers': 0, 'removed_contained_buildings': 0}
    
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
        return features, {'checked': 0, 'removed_unnamed_containers': 0, 'removed_contained_buildings': 0}
    
    tree = STRtree(building_geoms)
    
    # Track which features to remove
    to_remove = set()
    removed_unnamed_containers = 0
    removed_contained_buildings = 0
    
    for i, geom in enumerate(building_geoms):
        if i in to_remove:
            continue
            
        feature = building_map[i]
        fid = feature['id']
        props = feature['properties']
        has_name = bool(props.get('name', '').strip())
        area = props.get('area_sqm', 0)
        
        # Find potential containments (features this one might contain)
        candidates = tree.query(geom)
        
        for j in candidates:
            if i == j or j in to_remove:
                continue
                
            other_feature = building_map[j]
            other_fid = other_feature['id']
            other_props = other_feature['properties']
            other_area = other_props.get('area_sqm', 0)
            other_geom = building_geoms[j]
            
            # Check if one contains the other (use centroid for speed)
            # The larger one is the potential container
            if area > other_area * 1.5:  # i is larger, might contain j
                if geom.contains(other_geom.centroid):
                    if has_name:
                        # Named container: remove the contained building
                        to_remove.add(j)
                        removed_contained_buildings += 1
                    else:
                        # Unnamed container: remove the container, keep individual buildings
                        to_remove.add(i)
                        removed_unnamed_containers += 1
                        break  # Stop checking, this container is removed
            elif other_area > area * 1.5:  # j is larger, might contain i
                other_has_name = bool(other_props.get('name', '').strip())
                if other_geom.contains(geom.centroid):
                    if other_has_name:
                        # Named container: remove this building (i)
                        to_remove.add(i)
                        removed_contained_buildings += 1
                        break
                    # else: unnamed container will be handled when we process j
    
    # Build filtered list
    kept_buildings = [building_map[i] for i in range(len(building_geoms)) if i not in to_remove]
    
    stats = {
        'checked': len(buildings),
        'removed_unnamed_containers': removed_unnamed_containers,
        'removed_contained_buildings': removed_contained_buildings
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
    print(f"[areal] [{_ts()}] Read done in {_fmt(time.time() - t)} — {len(handler.features):,} features found")

    print(f"\n[areal] [{_ts()}] Filtering nested buildings...")
    t = time.time()
    features, nest_stats = filter_nested_buildings(handler.features, handler.geometries)
    print(f"[areal] [{_ts()}] Nesting filter done in {_fmt(time.time() - t)}")
    print(f"  Checked: {nest_stats['checked']:,} buildings")
    print(f"  Removed unnamed containers: {nest_stats['removed_unnamed_containers']:,}")
    print(f"  Removed buildings inside named areas: {nest_stats['removed_contained_buildings']:,}")
    print(f"  Kept: {len(features):,}")

    # Date filtering temporarily disabled for statistics gathering
    filtered_features = features
    print(f"\n[areal] Date filtering: DISABLED (keeping all {len(filtered_features):,} features)")

    print(f"\n[areal] [{_ts()}] Writing {OUTPUT_FILE}...")
    t = time.time()
    collection = {'type': 'FeatureCollection', 'features': filtered_features}
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(collection, f, ensure_ascii=False, separators=(',', ':'))
    print(f"[areal] [{_ts()}] Write done in {_fmt(time.time() - t)}")

    print("\n[areal] Sample features:")
    for feature in filtered_features[:10]:
        props = feature['properties']
        name = (props.get('display_name') or 'Unnamed')[:50]
        area = props.get('area_sqm', 0)
        transport = props.get('transport_type', '?')
        print(f"  [{transport:10s}] {area:6,d} m² | {name}")

    print(f"\n[areal] [{_ts()}] Done! Total: {_fmt(time.time() - t_total)}")

if __name__ == '__main__':
    main()
