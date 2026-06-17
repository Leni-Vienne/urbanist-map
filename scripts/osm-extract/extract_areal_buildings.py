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
from shapely.geometry import mapping, shape, Polygon

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
# 'terrace' is NOT excluded: a terrace is a multi-dwelling row (a real residential development).
EXCLUDE_BUILDINGS = {
    'house', 'detached', 'semidetached_house', 'garage', 'garages',
    'shed', 'hut', 'cabin', 'roof', 'carport'
}

# Building/landuse types that mark a definite non-house development. These are exempt from
# the size gate; generic untyped construction is gated since it is more likely a house.
NONHOUSE_TYPES = {
    'apartments', 'commercial', 'office', 'retail', 'industrial', 'hospital', 'school',
    'hotel', 'university', 'warehouse', 'public', 'civic', 'college', 'kindergarten',
    'church', 'dormitory', 'clinic', 'sports_centre', 'train_station', 'transportation',
    'education', 'government', 'farm', 'terrace'
}

# Maps an OSM building/landuse type value to a coarse project category surfaced as a filter tag.
CATEGORY_BY_VALUE = {
    'apartments': 'residential', 'residential': 'residential', 'dormitory': 'residential',
    'terrace': 'residential',
    'commercial': 'commercial',
    'retail': 'retail',
    'office': 'office',
    'industrial': 'industrial', 'warehouse': 'industrial',
}


def derive_building_category(values):
    """First recognised type among the given tag values wins; None if untyped."""
    for v in values:
        cat = CATEGORY_BY_VALUE.get(v)
        if cat:
            return cat
    return None


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

def classify_feature(tags):
    """Tag-level qualification shared by closed areas and unclosed area-tagged ways.
    Returns 'park' or 'building' when the tags describe a proposed/construction
    development, or None when they don't qualify."""
    building = tags.get('building', '')
    landuse = tags.get('landuse', '')
    leisure = tags.get('leisure', '')
    amenity = tags.get('amenity', '')
    construction = tags.get('construction', '')
    proposed = tags.get('proposed', '')
    planned = tags.get('planned', '')
    proposed_building = tags.get('proposed:building', '')
    planned_building = tags.get('planned:building', '')
    construction_building = tags.get('construction:building', '')
    proposed_landuse = tags.get('proposed:landuse', '')
    planned_landuse = tags.get('planned:landuse', '')
    construction_landuse = tags.get('construction:landuse', '')

    park_values = ('park', 'garden', 'playground', 'recreation_ground', 'stadium', 'pitch', 'golf_course')
    is_park_construction = (
        leisure in ('park', 'garden', 'playground', 'recreation_ground', 'sports_centre',
                    'stadium', 'pitch', 'golf_course') and
        (construction or proposed or planned)
    ) or (
        construction in park_values or
        proposed in park_values or
        planned in park_values
    )

    is_building_construction = (
        building in ('construction', 'proposed', 'planned') or
        landuse == 'construction' or
        leisure in ('construction', 'proposed', 'planned') or
        amenity in ('construction', 'proposed', 'planned') or
        construction in NONHOUSE_TYPES or construction == 'yes' or
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
        return None

    # Exclude small residential building types
    target_use = tags.get('construction', tags.get('construction:building', tags.get('proposed', tags.get('planned', tags.get('proposed:building', tags.get('planned:building', tags.get('building:use', '')))))))
    if target_use in EXCLUDE_BUILDINGS:
        return None

    # When the primary identity is a construction site (landuse=construction, building tag, etc.)
    # the feature is an area, not transport infrastructure. infrastructure_keys checks below
    # must be skipped in that context so construction:railway/highway etc. don't wrongly
    # exclude a subway station or road tunnel construction site.
    has_areal_context = (landuse == 'construction' or building != '' or
                         leisure in ('construction', 'proposed', 'planned') or
                         amenity in ('construction', 'proposed', 'planned') or
                         proposed_building != '' or planned_building != '' or construction_building != '' or
                         proposed_landuse != '' or planned_landuse != '' or construction_landuse != '')

    # Exclude utility/industrial infrastructure that is out of scope regardless of areal context
    # (power plants, solar farms, telecom, man-made structures like pipelines).
    utility_keys = {'power', 'telecom', 'man_made'}
    # When the primary identity is a construction site (landuse=construction, building tag, etc.)
    # the feature is an area, not transport infrastructure. infrastructure_keys checks below
    # must be skipped in that context so construction:railway/highway etc. don't wrongly
    # exclude a subway station or road tunnel construction site.
    has_areal_context = (landuse == 'construction' or building != '' or
                         leisure in ('construction', 'proposed', 'planned') or
                         amenity in ('construction', 'proposed', 'planned') or
                         proposed_building != '' or planned_building != '' or construction_building != '' or
                         proposed_landuse != '' or planned_landuse != '' or construction_landuse != '')

    # Exclude utility/industrial infrastructure that is out of scope regardless of areal context
    # (power plants, solar farms, telecom, man-made structures like pipelines).
    utility_keys = {'power', 'telecom', 'man_made'}
    if any(f'{prefix}{k}' in tags
           for k in utility_keys
           for prefix in ('', 'construction:', 'proposed:', 'planned:')):
        return None

    # Exclude transport infrastructure mapped as polygons (railway yard, road junction area, etc.)
    # unless the primary identity is a construction site area: a subway station or road tunnel
    # under construction with landuse=construction + construction:railway/highway is a valid
    # areal project, not a transport-infrastructure polygon.
    transport_keys = {'highway', 'railway', 'waterway', 'public_transport', 'aerialway', 'aeroway'}
    if not has_areal_context and any(f'{prefix}{k}' in tags
                                     for k in transport_keys
                                     for prefix in ('', 'construction:', 'proposed:', 'planned:')):
        return None

    # Exclude transport infrastructure mapped as polygons (railway yard, road junction area, etc.)
    # unless the primary identity is a construction site area: a subway station or road tunnel
    # under construction with landuse=construction + construction:railway/highway is a valid
    # areal project, not a transport-infrastructure polygon.
    transport_keys = {'highway', 'railway', 'waterway', 'public_transport', 'aerialway', 'aeroway'}
    if not has_areal_context and any(f'{prefix}{k}' in tags
                                     for k in transport_keys
                                     for prefix in ('', 'construction:', 'proposed:', 'planned:')):
        return None

    # Road and cycleway highway values are always linear; exclude them even with areal context
    # (e.g. a bridge deck mapped as building=construction + highway=cycleway).
    # Area-capable values (pedestrian, platform, rest_area, services, footway, path) are
    # intentionally kept so pedestrian plazas and transit platforms under construction survive.
    _LINEAR_HIGHWAY_VALUES = frozenset({
        'motorway', 'motorway_link', 'trunk', 'trunk_link',
        'primary', 'primary_link', 'secondary', 'secondary_link',
        'tertiary', 'tertiary_link', 'residential', 'unclassified',
        'service', 'living_street', 'road', 'bus_guideway', 'busway', 'cycleway',
    })
    if has_areal_context and tags.get('highway', '') in _LINEAR_HIGHWAY_VALUES:
        return None

    # Exclude features where construction/proposed value is a transport infrastructure type.
    # With landuse=construction or a building tag, the value names the future land use
    # (e.g. construction=residential -> landuse=residential), not a road class, so keep it.
    infrastructure_values = {
        'tram', 'rail', 'railway', 'light_rail', 'subway', 'narrow_gauge', 'train',
        'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
        'cycleway', 'footway', 'pedestrian', 'path', 'track', 'road', 'bridge', 'tunnel'
    }
    if not has_areal_context and (tags.get('construction') in infrastructure_values or tags.get('proposed') in infrastructure_values):
        return None

    return 'park' if is_park_construction else 'building'


class ArealExtractionHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.wkbfab = osmium.geom.WKBFactory()
        self.features = []
        self.geometries = {}  # feature_id -> shapely geometry, for containment checks

    def area(self, a):
        tags = {t.k: t.v for t in a.tags}
        kind = classify_feature(tags)
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
        kind = classify_feature(tags)
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
        building = tags.get('building', '')
        landuse = tags.get('landuse', '')
        leisure = tags.get('leisure', '')
        amenity = tags.get('amenity', '')
        construction = tags.get('construction', '')
        proposed = tags.get('proposed', '')
        planned = tags.get('planned', '')
        proposed_building = tags.get('proposed:building', '')
        planned_building = tags.get('planned:building', '')
        construction_building = tags.get('construction:building', '')
        proposed_landuse = tags.get('proposed:landuse', '')
        planned_landuse = tags.get('planned:landuse', '')
        construction_landuse = tags.get('construction:landuse', '')

        lat = geom.centroid.y
        area_m2 = geom.area * (111320**2) * math.cos(math.radians(lat))

        # A definite non-house type is exempt from the size gate; only generic untyped
        # construction is gated to drop houses. A bare landuse=construction (no target use,
        # no name) says nothing about what is being built, so it stays gated.
        has_nonhouse_signal = (
            building in NONHOUSE_TYPES or construction in NONHOUSE_TYPES or
            proposed in NONHOUSE_TYPES or planned in NONHOUSE_TYPES or
            proposed_building in NONHOUSE_TYPES or planned_building in NONHOUSE_TYPES or
            construction_building in NONHOUSE_TYPES or
            landuse in ('commercial', 'retail', 'industrial', 'residential') or
            proposed_landuse in ('commercial', 'retail', 'industrial', 'residential') or
            planned_landuse in ('commercial', 'retail', 'industrial', 'residential') or
            construction_landuse in ('commercial', 'retail', 'industrial', 'residential')
        )

        # Lifecycle target tags come first: on a redevelopment site (e.g. landuse=retail with
        # planned:landuse=residential), the future use defines the category, not the current one.
        category = derive_building_category([
            construction, proposed, planned,
            proposed_building, planned_building, construction_building,
            proposed_landuse, planned_landuse, construction_landuse,
            building, landuse,
        ])

        # Single size gate: untyped, unannotated construction below 400 m² of gross floor
        # area (footprint × building:levels) is dropped as a house-sized footprint.
        # Everything else is kept regardless of size: parks, typed developments (category or
        # non-house signal), and features a mapper identified (name, wikidata, description,
        # website). Type exclusions in classify_feature still apply first.
        has_identity = any(tags.get(k, '').strip() for k in ('name', 'wikidata', 'description', 'website'))
        if kind == 'building' and category is None and not has_nonhouse_signal and not has_identity:
            try:
                levels = max(float(tags.get('building:levels', '')), 1.0)
            except ValueError:
                levels = 1.0
            if area_m2 * levels < 400:
                return
        feature_kind = kind

        props = dict(tags)
        props['transport_type'] = feature_kind
        if feature_kind == 'building' and category:
            props['building_category'] = category

        # construction= is the strongest signal, check it first
        if construction and construction not in ('yes', 'no'):
            status_check = 'under_construction'
        elif building == 'construction' or tags.get('landuse') == 'construction' or 'construction' in (leisure, amenity) or (construction_building and construction_building != 'no') or (construction_landuse and construction_landuse != 'no'):
            status_check = 'under_construction'
        elif building == 'proposed' or 'proposed' in (leisure, amenity) or (proposed and proposed != 'no') or (proposed_building and proposed_building != 'no') or (proposed_landuse and proposed_landuse != 'no'):
            status_check = 'proposed'
        elif building == 'planned' or 'planned' in (leisure, amenity) or (planned and planned != 'no') or (planned_building and planned_building != 'no') or (planned_landuse and planned_landuse != 'no'):
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
