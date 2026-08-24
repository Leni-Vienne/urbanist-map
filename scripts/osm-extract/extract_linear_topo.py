#!/usr/bin/env python3
"""
Extract proposed/construction linear transport features, topology-based orphan grouping.

Covers railways, roads, aerialways (cable cars/gondolas/funiculars),
waterways, cycling and pedestrian paths.

Orphan ways are grouped by connected components (shared endpoints) and then
optionally merged by ref/name proximity.
This is safe worldwide: ref=1 in Berlin won't merge with ref=1 in Shanghai.
"""

import math
import re
import json
import argparse
import time
import osmium
from collections import defaultdict
from datetime import datetime
from shapely.geometry import LineString, mapping, box
from shapely.ops import linemerge
from shapely.strtree import STRtree

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _parse_args():
    parser = argparse.ArgumentParser(description='Extract proposed/construction linear transport features from OSM.')
    parser.add_argument('--ways-file', default='planet-latest_proposed_ways.osm.pbf',
                        help='Filtered PBF containing only proposed/construction ways')
    parser.add_argument('--source-file', default='planet-latest_proposed_relations.osm.pbf',
                        help='Relations-only PBF (used for relation scanning)')
    parser.add_argument('--output', default='planet-latest_proposed_linear.geojson',
                        help='Output GeoJSON file path')
    return parser.parse_args()


# Transport type mappings (single source of truth)
TRANSPORT_TYPES = {
    # Rail family
    'rail': ('rail', 'railway'),
    'tram': ('tram',),
    'subway': ('subway', 'metro'),
    'light_rail': ('light_rail',),
    'narrow_gauge': ('narrow_gauge',),
    'monorail': ('monorail',),
    'miniature': ('miniature',),
    # Aerial family
    'funicular': ('funicular',),
    'gondola': ('gondola',),
    'cable_car': ('cable_car', 'chair_lift', 'mixed_lift', 'drag_lift', 
                  'j-bar', 't-bar', 'platter', 'rope_tow', 'zip_line'),
    # Road family ('highway' is the class-less umbrella value, e.g. proposed=highway)
    'road': ('motorway', 'trunk', 'primary', 'secondary', 'tertiary',
             'residential', 'unclassified', 'service', 'living_street', 'road', 'highway'),
    'bus': ('bus_guideway', 'busway'),
    # Active mobility
    'bike': ('cycleway', 'bicycle'),
    'pedestrian': ('pedestrian', 'footway', 'path', 'steps'),
    # Water ('waterway' is the class-less umbrella value, e.g. proposed=waterway)
    'waterway': ('canal', 'river', 'stream', 'waterway'),
    # Air
    'airport': ('runway', 'taxiway', 'airstrip'),
}

# Build reverse lookup: value -> canonical type
_VALUE_TO_TYPE = {}
for canonical, values in TRANSPORT_TYPES.items():
    for v in values:
        _VALUE_TO_TYPE[v] = canonical

# Broad transport groups for safe merging
BROAD_GROUPS = {
    'rail': ('rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'monorail', 'miniature'),
    'road': ('road', 'bus'),
    'bike': ('bike',),
    'pedestrian': ('pedestrian',),
    'aerial': ('cable_car', 'gondola', 'funicular'),
    'waterway': ('waterway',),
    'airport': ('airport',),
}

_TYPE_TO_GROUP = {}
for group, types in BROAD_GROUPS.items():
    for t in types:
        _TYPE_TO_GROUP[t] = group

TYPE_LABELS = {
    'rail': 'Railway', 'light_rail': 'Light Rail', 'subway': 'Metro',
    'tram': 'Tram', 'narrow_gauge': 'Narrow Gauge Railway', 'monorail': 'Monorail',
    'miniature': 'Miniature Railway', 'cable_car': 'Cable Car', 'gondola': 'Gondola',
    'funicular': 'Funicular', 'road': 'Road', 'bus': 'Bus Infrastructure',
    'bike': 'Cycling Path', 'pedestrian': 'Pedestrian Path', 'waterway': 'Waterway',
    'airport': 'Airport Infrastructure',
}

# All valid transport values for filtering ways
TRANSPORT_VALUES = set(_VALUE_TO_TYPE.keys())

URL_RE = re.compile(r'https?://\S+')


# ---------------------------------------------------------------------------
# Union-Find (reusable)
# ---------------------------------------------------------------------------

class UnionFind:
    """Simple Union-Find with path compression."""
    
    def __init__(self, items):
        self.parent = {x: x for x in items}
    
    def find(self, x):
        # Iterative with path compression: long union chains would blow the
        # recursion limit on planet-scale inputs.
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root
    
    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)
    
    def groups(self):
        """Return dict of root -> [members]."""
        result = defaultdict(list)
        for x in self.parent:
            result[self.find(x)].append(x)
        return dict(result)


# ---------------------------------------------------------------------------
# Geometry utilities
# ---------------------------------------------------------------------------

def snap_coord(coord, precision=6):
    """Snap coordinate to grid (precision decimals ≈ 0.1m at precision=6)."""
    return (round(coord[0], precision), round(coord[1], precision))


def bbox_of_coords(coords):
    """Return (minlon, minlat, maxlon, maxlat) for a list of coords."""
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def bbox_distance_km(a, b):
    """Minimum distance in km between two bboxes. Returns 0 if they overlap."""
    lon_gap = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    lat_gap = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    mean_lat = (a[1] + a[3] + b[1] + b[3]) / 4
    km_per_lon_deg = 111.32 * abs(math.cos(math.radians(mean_lat)))
    return math.sqrt((lon_gap * km_per_lon_deg) ** 2 + (lat_gap * 111) ** 2)


def compute_bearing(coords):
    """Compute dominant bearing (0-180°) from start to end of linestring."""
    if len(coords) < 2:
        return 0
    dx = coords[-1][0] - coords[0][0]
    dy = coords[-1][1] - coords[0][1]
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        dx = coords[1][0] - coords[0][0]
        dy = coords[1][1] - coords[0][1]
    # Longitude degrees shrink with latitude; scale dx so the bearing is geometric.
    dx *= abs(math.cos(math.radians((coords[0][1] + coords[-1][1]) / 2)))
    return math.degrees(math.atan2(dx, dy)) % 180


def bearing_diff(b1, b2):
    """Minimum angle difference between two bearings (0-180 range)."""
    diff = abs(b1 - b2) % 180
    return min(diff, 180 - diff)


def meters_to_degrees(meters):
    """Approximate conversion at mid-latitudes."""
    return meters / 111320


# ---------------------------------------------------------------------------
# Transport type detection
# ---------------------------------------------------------------------------

def get_transport_type(tags):
    """Derive canonical transport type from OSM tags."""
    # Check construction=/proposed=/planned= sub-type keys.
    # Collect all matched types first so bike can take priority over pedestrian.
    lifecycle_types = []
    for key in ('construction', 'proposed', 'planned'):
        val = tags.get(key, '')
        if val and val not in ('yes', 'no') and val in _VALUE_TO_TYPE:
            lifecycle_types.append(_VALUE_TO_TYPE[val])
    if lifecycle_types:
        return 'bike' if 'bike' in lifecycle_types else lifecycle_types[0]

    # Check lifecycle prefix keys: proposed:railway=subway, planned:highway=primary, etc.
    for key, fallback in [('construction:aerialway', 'cable_car'), ('construction:railway', 'rail'),
                          ('construction:highway', 'road'), ('construction:waterway', 'waterway'),
                          ('construction:aeroway', 'airport'),
                          ('proposed:aerialway', 'cable_car'), ('proposed:railway', 'rail'),
                          ('proposed:highway', 'road'), ('proposed:waterway', 'waterway'),
                          ('proposed:aeroway', 'airport'),
                          ('planned:aerialway', 'cable_car'), ('planned:railway', 'rail'),
                          ('planned:highway', 'road'), ('planned:waterway', 'waterway'),
                          ('planned:aeroway', 'airport')]:
        val = tags.get(key, '')
        if val:
            if val in _VALUE_TO_TYPE:
                return _VALUE_TO_TYPE[val]
            return fallback

    # Check boolean flags for specific rail types
    for rail_type in ('subway', 'tram', 'light_rail', 'narrow_gauge', 'monorail', 'miniature'):
        if tags.get(rail_type) == 'yes':
            return _VALUE_TO_TYPE[rail_type]

    # A proposed cycle lane rides on a road with a live highway tag, so the cycleway
    # keys must win over the primary-key fallback (which would return 'road').
    if (not any(tags.get(k) in _LIFECYCLE_STATUSES for k in _PRIMARY_TRANSPORT_KEYS) and
            any(tags.get(k) in _LIFECYCLE_STATUSES for k in _CYCLEWAY_KEYS)):
        return 'bike'

    # Check primary keys
    for key, fallback in [('aerialway', 'cable_car'), ('railway', 'rail'),
                          ('highway', 'road'), ('waterway', 'waterway'),
                          ('aeroway', 'airport')]:
        val = tags.get(key, '')
        if val:
            # For X=proposed/construction/planned, check the matching lifecycle sub-type key
            if val in ('proposed', 'construction', 'planned'):
                specific = (tags.get(f'proposed:{key}', '') or
                            tags.get(f'construction:{key}', '') or
                            tags.get(f'planned:{key}', ''))
                if specific in _VALUE_TO_TYPE:
                    return _VALUE_TO_TYPE[specific]
            if val in _VALUE_TO_TYPE:
                return _VALUE_TO_TYPE[val]
            return fallback

    return ''  # fallback: unknown transport type


def broad_group(transport_type):
    """Map transport type to broad family (rail/road/active/aerial/waterway)."""
    return _TYPE_TO_GROUP.get(transport_type, 'other')


def get_project_status(tags):
    """Return 'under_construction', 'planned', or 'proposed'."""
    if any(tags.get(k) == 'construction' for k in ('railway', 'highway', 'waterway', 'aerialway', 'aeroway',
                                                   'cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both', 'state')):
        return 'under_construction'
    if tags.get('construction', '') not in ('', 'no'):
        return 'under_construction'
    if any(tags.get(k) for k in ('construction:railway', 'construction:highway', 'construction:waterway', 'construction:aerialway', 'construction:aeroway')):
        return 'under_construction'
    if tags.get('railway') in ('subway', 'tram', 'light_rail', 'monorail', 'miniature') and \
            any(tags.get(k) for k in ('construction:electrified', 'construction:voltage',
                                      'construction:frequency', 'construction:tracks')):
        return 'under_construction'
    if any(tags.get(k) == 'planned' for k in ('railway', 'highway', 'waterway', 'aerialway', 'aeroway',
                                              'cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both', 'state')):
        return 'planned'
    if tags.get('planned', '') not in ('', 'no'):
        return 'planned'
    if any(tags.get(k) for k in ('planned:railway', 'planned:highway', 'planned:waterway', 'planned:aerialway', 'planned:aeroway')):
        return 'planned'
    return 'proposed'


def aggregate_project_status(statuses):
    """Majority vote across way statuses; ties prefer the less certain status
    (proposed > planned > under_construction)."""
    counts = {'under_construction': 0, 'planned': 0, 'proposed': 0}
    for s in statuses:
        counts[s] += 1
    if counts['proposed'] >= counts['under_construction'] and counts['proposed'] >= counts['planned']:
        return 'proposed'
    if counts['planned'] >= counts['under_construction']:
        return 'planned'
    return 'under_construction'


_LIFECYCLE_STATUSES = ('proposed', 'construction', 'planned')
_PRIMARY_TRANSPORT_KEYS = ('railway', 'highway', 'waterway', 'aerialway', 'aeroway')
_CYCLEWAY_KEYS = ('cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both')
_LIFECYCLE_PREFIX_KEYS = tuple(
    f'{status}:{key}'
    for status in _LIFECYCLE_STATUSES
    for key in _PRIMARY_TRANSPORT_KEYS
)
_URBAN_RAIL_VALUES = ('subway', 'tram', 'light_rail', 'monorail', 'miniature')
_URBAN_RAIL_CONSTRUCTION_KEYS = (
    'construction:electrified', 'construction:voltage',
    'construction:frequency', 'construction:tracks',
)


def has_relation_lifecycle(tags):
    """Return whether relation tags explicitly describe future infrastructure."""
    if any(tags.get(key, '') not in ('', 'no')
           for key in ('construction', 'proposed', 'planned')):
        return True
    if any(tags.get(key) in _LIFECYCLE_STATUSES
           for key in (*_PRIMARY_TRANSPORT_KEYS, *_CYCLEWAY_KEYS, 'state')):
        return True
    if any(tags.get(key, '') not in ('', 'no') for key in _LIFECYCLE_PREFIX_KEYS):
        return True
    return (
        tags.get('railway') in _URBAN_RAIL_VALUES
        and any(tags.get(key, '') not in ('', 'no')
                for key in _URBAN_RAIL_CONSTRUCTION_KEYS)
    )


def is_transport_way(tags):
    """Return True if way represents proposed/construction/planned transport infrastructure."""
    # landuse/building ways are areas handled by the areal extractor; exclude them first
    # so lifecycle prefix keys like construction:railway don't accidentally pull them in.
    if 'landuse' in tags or tags.get('building', 'no') != 'no':
        return False

    # Explicit lifecycle status as primary key value: railway=proposed, highway=planned, etc.
    if any(tags.get(k) in _LIFECYCLE_STATUSES for k in _PRIMARY_TRANSPORT_KEYS):
        return True

    # Lifecycle prefix keys: proposed:railway=subway, planned:highway=primary, etc.
    if any(tags.get(k) for k in _LIFECYCLE_PREFIX_KEYS):
        return True

    # Lifecycle modifier (planned=yes / proposed=yes) on a typed transport way.
    # e.g. aerialway=chairlift + planned=yes, highway=primary + proposed=yes
    if any(tags.get(lc) == 'yes' for lc in ('planned', 'proposed')):
        if any(tags.get(k) and tags.get(k) not in _LIFECYCLE_STATUSES
               for k in _PRIMARY_TRANSPORT_KEYS):
            return True

    # Cycle lane proposed/under construction along an existing road:
    # highway=tertiary + cycleway=proposed (or cycleway:left/right/both)
    if any(tags.get(k) in _LIFECYCLE_STATUSES for k in _CYCLEWAY_KEYS):
        return True

    # Legacy state=proposed/construction/planned scheme on a typed transport way:
    # highway=secondary + state=proposed
    if tags.get('state') in _LIFECYCLE_STATUSES:
        if any(tags.get(k) and tags.get(k) not in _LIFECYCLE_STATUSES
               for k in _PRIMARY_TRANSPORT_KEYS):
            return True

    # Partially-built urban transit: track bed done but operational systems still
    # under construction (e.g. railway=subway + construction:electrified=contact_line).
    # Restricted to urban/transit rail types -- mainline rail electrification retrofits
    # are ongoing operations on existing lines, not new projects.
    if tags.get('railway') in _URBAN_RAIL_VALUES and any(
            tags.get(k) for k in _URBAN_RAIL_CONSTRUCTION_KEYS):
        return True

    return (tags.get('construction', '') in TRANSPORT_VALUES or
            tags.get('proposed', '') in TRANSPORT_VALUES or
            tags.get('planned', '') in TRANSPORT_VALUES)


# ---------------------------------------------------------------------------
# Naming helpers
# ---------------------------------------------------------------------------

def clean_description(desc):
    """Strip URLs from description. Returns (cleaned_text, first_url_or_None)."""
    urls = URL_RE.findall(desc)
    clean = re.sub(r'\s+', ' ', URL_RE.sub('', desc)).strip()
    return clean, urls[0] if urls else None


def clean_props(props):
    """Strip URLs from description, optionally move to source."""
    desc = props.get('description', '')
    if desc and URL_RE.search(desc):
        clean, url = clean_description(desc)
        props['description'] = clean
        if url and not props.get('source', '').strip():
            props['source'] = url
    return props


def best_name_from_tags(tags_list):
    """Get best name from a list of tag dicts.
    
    Priority order:
    1. Actual name tags (prefer longer/more descriptive names over generic ones)
    2. Extract title from wikipedia tag (strips language prefix like "de:" or "en:")
    3. Description (but not overly short/generic ones)
    """
    names = []
    for tags in tags_list:
        name = tags.get('name', '').strip()
        if name:
            names.append(name)

    if names:
        return sorted(names, key=len, reverse=True)[0]

    # Fall back to localized name tags (name:en first, then any name:*)
    for tags in tags_list:
        name_en = tags.get('name:en', '').strip()
        if name_en:
            return name_en
    for tags in tags_list:
        for k, v in tags.items():
            if k.startswith('name:') and v.strip():
                return v.strip()
    
    # Try wikipedia tag: strip language prefix (e.g. "de:", "en:") and convert underscores
    for tags in tags_list:
        wiki = tags.get('wikipedia', '').strip()
        if wiki and ':' in wiki:
            wiki_title = wiki.split(':', 1)[1].replace('_', ' ')
            if wiki_title:
                return wiki_title
    
    # Fall back to description, skipping very short ones
    for tags in tags_list:
        desc = tags.get('description', '').strip()
        if desc:
            cleaned, _ = clean_description(desc)
            cleaned = re.sub(r'\s*\([^)]*\)\s*$', '', cleaned).strip()
            if cleaned and len(cleaned) >= 4:
                return cleaned
    
    return None


def create_display_name(props, tags_list=None):
    """Create human-readable display name."""
    if tags_list:
        best = best_name_from_tags(tags_list)
        if best:
            return best
    
    if props.get('name', '').strip():
        return props['name'].strip()

    # Fall back to localized name tags (name:en first, then any name:*)
    if props.get('name:en', '').strip():
        return props['name:en'].strip()
    for k, v in props.items():
        if k.startswith('name:') and v.strip():
            return v.strip()

    if props.get('description', '').strip():
        cleaned, _ = clean_description(props['description'])
        cleaned = re.sub(r'\s*\([^)]*\)\s*$', '', cleaned).strip()
        if cleaned:
            return cleaned
    
    from_tag, to_tag = props.get('from', '').strip(), props.get('to', '').strip()
    if from_tag and to_tag:
        ref = props.get('ref', '').strip()
        return f"{from_tag} – {to_tag} (line {ref})" if ref else f"{from_tag} – {to_tag}"

    # Fall back to ref alone (e.g. "A 154" for a road relation with no name/from/to)
    ref = props.get('ref', '').strip()
    if ref:
        return ref

    return None


# ---------------------------------------------------------------------------
# OSM handlers
# ---------------------------------------------------------------------------

class WayGeometryHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}
        self.unrenderable_way_ids = set()

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if not is_transport_way(tags):
            return
        try:
            coords = [(n.location.lon, n.location.lat) for n in w.nodes if n.location.valid()]
            if len(coords) >= 2:
                self.ways[w.id] = {
                    'coords': coords,
                    'tags': tags,
                    'timestamp': w.timestamp.isoformat() if w.timestamp else None
                }
            else:
                self.unrenderable_way_ids.add(w.id)
        except Exception:
            self.unrenderable_way_ids.add(w.id)


class RelationHandler(osmium.SimpleHandler):
    def __init__(self, candidate_ways, unrenderable_way_ids=()):
        super().__init__()
        self.candidate_ways = candidate_ways
        self.unrenderable_way_ids = unrenderable_way_ids
        self.relations = {}

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        # Skip relations that document past infrastructure, not future projects
        _PAST_VALUES = ('historic', 'abandoned', 'razed', 'dismantled', 'disused', 'removed')
        if any(tags.get(k, '') in _PAST_VALUES
               for k in ('railway', 'highway', 'waterway', 'aerialway', 'aeroway')):
            return
        if tags.get('historic') or tags.get('abandoned'):
            return
        # Multipolygon relations are areas; linearizing their member ways changes their geometry.
        if tags.get('type') == 'multipolygon':
            return
        member_way_ids = [m.ref for m in r.members if m.type == 'w']
        # Skip route relations that aren't themselves proposed/construction projects
        if tags.get('type') == 'route':
            has_lifecycle = has_relation_lifecycle(tags)

            # Road-service route types run on existing roads and are never themselves
            # infrastructure being built. A bus detour through a construction zone doesn't
            # make the route a project, require an explicit lifecycle tag on the relation.
            _ROAD_SERVICE_ROUTE_TYPES = ('bus', 'coach', 'trolleybus', 'share_taxi')
            if tags.get('route', '') in _ROAD_SERVICE_ROUTE_TYPES:
                if not has_lifecycle:
                    return

            # The relations PBF contains the complete member ID list but no ordinary-way
            # geometry. Use candidate member count over total member count so both sides
            # of the ratio come from populations this pass actually knows.
            elif not has_lifecycle:
                if member_way_ids:
                    construction_member_count = sum(
                        wid in self.candidate_ways or wid in self.unrenderable_way_ids
                        for wid in member_way_ids
                    )
                    construction_member_ratio = (
                        construction_member_count / len(member_way_ids)
                    )

                    # Infrastructure routes must be at least 75% candidate members;
                    # service routes may include existing connections and require 50%.
                    threshold = 0.75 if tags.get('route', '') == 'tracks' else 0.50
                    if construction_member_ratio < threshold:
                        return
                else:
                    return
        
        # Keep only relations with at least one proposed/construction member way.
        # Routes tagged state=proposed over fully existing roads (e.g. cycle-node
        # networks awaiting signposting) have none and are dropped: no new
        # infrastructure is being built.
        candidate_member_way_ids = [
            wid for wid in member_way_ids if wid in self.candidate_ways
        ]
        if candidate_member_way_ids:
            self.relations[r.id] = {
                'tags': tags,
                'member_way_ids': candidate_member_way_ids,
            }


# ---------------------------------------------------------------------------
# Component utilities (shared by merge functions)
# ---------------------------------------------------------------------------

class ComponentSet:
    """Manages orphan way components with cached properties."""
    
    def __init__(self, orphan_ways):
        self.ways = orphan_ways
        self.components = {}  # rep_id -> [way_ids]
        self._cache = {}  # (rep_id, prop) -> value
    
    def set_components(self, components):
        self.components = components
        self._cache.clear()
    
    def bbox(self, rep_id):
        key = (rep_id, 'bbox')
        if key not in self._cache:
            coords = [c for wid in self.components[rep_id] for c in self.ways[wid]['coords']]
            self._cache[key] = bbox_of_coords(coords)
        return self._cache[key]
    
    def transport_type(self, rep_id):
        key = (rep_id, 'type')
        if key not in self._cache:
            counts = defaultdict(int)
            for wid in self.components[rep_id]:
                counts[get_transport_type(self.ways[wid]['tags'])] += 1
            self._cache[key] = max(counts.items(), key=lambda kv: kv[1])[0] if counts else 'rail'
        return self._cache[key]
    
    def broad_type(self, rep_id):
        return broad_group(self.transport_type(rep_id))
    
    def is_anonymous(self, rep_id):
        key = (rep_id, 'anon')
        if key not in self._cache:
            anon = True
            for wid in self.components[rep_id]:
                tags = self.ways[wid]['tags']
                if any(tags.get(k, '').strip() for k in ('ref', 'name', 'description')):
                    anon = False
                    break
            self._cache[key] = anon
        return self._cache[key]
    
    def bearing(self, rep_id):
        key = (rep_id, 'bearing')
        if key not in self._cache:
            bearings = [compute_bearing(self.ways[wid]['coords']) 
                       for wid in self.components[rep_id] if wid in self.ways]
            if bearings:
                sin_sum = sum(math.sin(math.radians(2 * b)) for b in bearings)
                cos_sum = sum(math.cos(math.radians(2 * b)) for b in bearings)
                self._cache[key] = (math.degrees(math.atan2(sin_sum, cos_sum)) / 2) % 180
            else:
                self._cache[key] = 0
        return self._cache[key]
    
    def project_status(self, rep_id):
        key = (rep_id, 'status')
        if key not in self._cache:
            self._cache[key] = aggregate_project_status(
                get_project_status(self.ways[wid]['tags']) for wid in self.components[rep_id])
        return self._cache[key]

    def geometry(self, rep_id):
        key = (rep_id, 'geom')
        if key not in self._cache:
            lines = [LineString(self.ways[wid]['coords']) 
                    for wid in self.components[rep_id] 
                    if wid in self.ways and len(self.ways[wid]['coords']) >= 2]
            try:
                self._cache[key] = linemerge(lines) if lines else None
            except Exception:
                self._cache[key] = lines[0] if lines else None
        return self._cache[key]
    
    def get_keys(self, rep_id):
        """Get merge keys (refs/names/wikidata) for a component."""
        key = (rep_id, 'keys')
        if key not in self._cache:
            keys = set()
            bt = self.broad_type(rep_id)
            for wid in self.components[rep_id]:
                tags = self.ways[wid]['tags']
                for tag in ('ref', 'construction:ref', 'proposed:ref', 'official_ref'):
                    if tags.get(tag, '').strip():
                        keys.add(f'{tag}:{tags[tag].strip()}')
                # Only merge by name for major transit (not road/bike/pedestrian)
                if bt not in ('road', 'bike', 'pedestrian'):
                    best_name = best_name_from_tags([tags])
                    if best_name:
                        keys.add(f'name:{best_name}')
                # Merge by wikidata - strong indicator of same project
                if tags.get('wikidata', '').strip():
                    keys.add(f'wikidata:{tags["wikidata"].strip()}')
            self._cache[key] = keys
        return self._cache[key]


# ---------------------------------------------------------------------------
# Merge strategies
# ---------------------------------------------------------------------------

def merge_by_topology(cs):
    """Merge ways by shared endpoints (Union-Find on snapped coords)."""
    before = len(cs.ways)
    endpoint_to_ways = defaultdict(set)
    way_info = {}  # wid -> (broad_group, project_status, name)
    for wid, way in cs.ways.items():
        tags = way['tags']
        way_info[wid] = (broad_group(get_transport_type(tags)),
                         get_project_status(tags),
                         tags.get('name', '').strip())
        endpoint_to_ways[snap_coord(way['coords'][0])].add(wid)
        endpoint_to_ways[snap_coord(way['coords'][-1])].add(wid)

    uf = UnionFind(cs.ways.keys())
    for wids in endpoint_to_ways.values():
        wlist = list(wids)
        # All pairs at the endpoint: two compatible ways must merge even when a
        # third incompatible way shares the same endpoint.
        for i in range(len(wlist)):
            group_a, status_a, name_a = way_info[wlist[i]]
            for j in range(i + 1, len(wlist)):
                group_b, status_b, name_b = way_info[wlist[j]]
                # Only merge same broad type and same project status
                if group_a != group_b:
                    continue
                if status_a != status_b:
                    continue
                # Don't merge two named ways with different names, road/path intersections
                # are not project continuations
                if name_a and name_b and name_a != name_b:
                    continue
                uf.union(wlist[i], wlist[j])

    cs.set_components({root: wids for root, wids in uf.groups().items()})
    return before, len(cs.components)


def merge_by_ref(cs, max_distance_km=1.0, max_distance_wikidata_km=10.0):
    """Merge components sharing ref/name/wikidata within proximity.

    Uses a larger distance threshold for wikidata keys since they are a stronger
    signal that features belong to the same project.
    """
    before = len(cs.components)
    key_to_comps = defaultdict(list)
    for rep_id in cs.components:
        for k in cs.get_keys(rep_id):
            key_to_comps[k].append(rep_id)

    uf = UnionFind(cs.components.keys())
    for key, rep_ids in key_to_comps.items():
        if len(rep_ids) < 2:
            continue
        # Use larger threshold for wikidata-based merging
        threshold = max_distance_wikidata_km if key.startswith('wikidata:') else max_distance_km
        for i, ri in enumerate(rep_ids):
            for rj in rep_ids[i+1:]:
                if cs.broad_type(ri) == cs.broad_type(rj) and \
                   cs.project_status(ri) == cs.project_status(rj) and \
                   bbox_distance_km(cs.bbox(ri), cs.bbox(rj)) <= threshold:
                    uf.union(ri, rj)

    new_comps = defaultdict(list)
    for rep_id, way_ids in cs.components.items():
        new_comps[uf.find(rep_id)].extend(way_ids)
    cs.set_components(dict(new_comps))
    return before, len(cs.components)


def _bbox_to_box(b):
    return box(b[0], b[1], b[2], b[3])


def _expand_box(b, pad_lon, pad_lat):
    return box(b[0] - pad_lon, b[1] - pad_lat, b[2] + pad_lon, b[3] + pad_lat)


def absorb_anonymous(cs, max_distance_km=1.0):
    """Absorb anonymous components into nearest named component of exact same type.

    Uses line-to-line distance against the actual geometry of each named component.
    Bbox distance would treat any orphan inside a large enveloping component
    (e.g. a ring road spanning a whole metro area) as adjacent to it.
    """
    before = len(cs.components)
    named = [rid for rid in cs.components if not cs.is_anonymous(rid)]
    anonymous = [rid for rid in cs.components if cs.is_anonymous(rid)]

    if not named or not anonymous:
        return before, len(cs.components)

    max_dist_deg = meters_to_degrees(max_distance_km * 1000)

    # Group named components by (transport_type, project_status) and build one STRtree
    # per group over the buffered actual geometry of each named component.
    named_by_type_status = defaultdict(list)
    for nid in named:
        named_by_type_status[(cs.transport_type(nid), cs.project_status(nid))].append(nid)

    trees = {}     # key -> STRtree of buffered geometries
    idx_maps = {}  # key -> list of (rep_id, geometry); index matches tree
    for key, nids in named_by_type_status.items():
        entries = []
        bufs = []
        for nid in nids:
            g = cs.geometry(nid)
            if g is not None and not g.is_empty:
                entries.append((nid, g))
                bufs.append(g.buffer(max_dist_deg))
        if bufs:
            trees[key] = STRtree(bufs)
            idx_maps[key] = entries

    absorptions = {}
    for uid in anonymous:
        uid_key = (cs.transport_type(uid), cs.project_status(uid))
        if uid_key not in trees:
            continue
        anon_geom = cs.geometry(uid)
        if anon_geom is None or anon_geom.is_empty:
            continue
        candidates = trees[uid_key].query(anon_geom)
        best_target, best_dist = None, float('inf')
        for idx in candidates:
            nid, named_geom = idx_maps[uid_key][idx]
            try:
                d = anon_geom.distance(named_geom)
            except Exception:
                continue
            if d < best_dist:
                best_dist, best_target = d, nid
        if best_target is not None and best_dist <= max_dist_deg:
            absorptions[uid] = best_target

    new_comps = dict(cs.components)
    for uid, target in absorptions.items():
        new_comps[target] = new_comps[target] + new_comps.pop(uid)
    cs.set_components(new_comps)
    return before, len(cs.components)



def merge_by_name_proximity(cs, max_distance_m=100):
    """Merge components sharing the same OSM name tag that are within max_distance_m of each other.

    Uses geometry distance (not bbox) and Union-Find for transitive chain merging:
    if A is close to B and B is close to C (all same name), A+B+C all merge even if A is
    far from C directly.
    """
    before = len(cs.components)

    max_dist_deg = meters_to_degrees(max_distance_m)

    def osm_names(rep_id):
        names = set()
        for wid in cs.components[rep_id]:
            n = cs.ways[wid]['tags'].get('name', '').strip()
            if n:
                names.add(n)
        return names

    name_to_comps = defaultdict(list)
    for rep_id in cs.components:
        for n in osm_names(rep_id):
            name_to_comps[n].append(rep_id)

    uf = UnionFind(list(cs.components.keys()))

    for name, rep_ids in name_to_comps.items():
        if len(rep_ids) < 2:
            continue

        valid_rids = []
        valid_geoms = []
        valid_bufs = []
        for rid in rep_ids:
            g = cs.geometry(rid)
            if g is not None:
                valid_rids.append(rid)
                valid_geoms.append(g)
                valid_bufs.append(g.buffer(max_dist_deg))

        if len(valid_rids) < 2:
            continue

        tree = STRtree(valid_bufs)
        for i, ri in enumerate(valid_rids):
            for idx in tree.query(valid_bufs[i]):
                if idx <= i:
                    continue
                rj = valid_rids[idx]
                if cs.broad_type(ri) != cs.broad_type(rj):
                    continue
                try:
                    if valid_geoms[i].distance(valid_geoms[idx]) <= max_dist_deg:
                        uf.union(ri, rj)
                except Exception:
                    continue

    new_comps = defaultdict(list)
    for rep_id, way_ids in cs.components.items():
        new_comps[uf.find(rep_id)].extend(way_ids)
    cs.set_components(dict(new_comps))

    return before, len(cs.components)


def cluster_anonymous(cs, max_distance_km=0.2):
    """Merge anonymous components of the same broad type that are physically close.
    Useful for fragmented interchanges or station tracks."""
    before = len(cs.components)
    anonymous = [rid for rid in cs.components if cs.is_anonymous(rid)]

    if len(anonymous) < 2:
        return before, len(cs.components)

    pad_lat = max_distance_km / 111

    # Group anonymous components by (broad_type, project_status) and build one STRtree per group.
    anon_by_btype = defaultdict(list)
    for rid in anonymous:
        anon_by_btype[(cs.broad_type(rid), cs.project_status(rid))].append(rid)

    uf = UnionFind(anonymous)

    for btype, rids in anon_by_btype.items():
        if len(rids) < 2:
            continue
        geoms = [_bbox_to_box(cs.bbox(rid)) for rid in rids]
        tree = STRtree(geoms)
        for i, ri in enumerate(rids):
            bb = cs.bbox(ri)
            # Longitude degrees shrink with latitude; the floor keeps the
            # prefilter box bounded near the poles.
            km_per_lon_deg = max(20.0, 111.32 * abs(math.cos(math.radians((bb[1] + bb[3]) / 2))))
            query_box = _expand_box(bb, max_distance_km / km_per_lon_deg, pad_lat)
            for idx in tree.query(query_box):
                if idx <= i:
                    continue
                rj = rids[idx]
                if bbox_distance_km(cs.bbox(ri), cs.bbox(rj)) <= max_distance_km:
                    uf.union(ri, rj)
                    
    groups = uf.groups()
    merge_count = sum(1 for g in groups.values() if len(g) > 1)

    if merge_count > 0:
        new_comps = dict(cs.components)
        for root, group_ids in groups.items():
            if len(group_ids) > 1:
                all_ways = []
                for gid in group_ids:
                    all_ways.extend(new_comps.pop(gid, []))
                new_comps[root] = all_ways
        cs.set_components(new_comps)

    return before, len(cs.components)


def merge_parallel_tracks(cs, max_distance_m=10, max_bearing_diff=15):
    """Merge anonymous parallel rail tracks (last resort)."""
    before = len(cs.components)
    anon_rail = [rid for rid in cs.components
                 if cs.is_anonymous(rid) and cs.broad_type(rid) == 'rail']

    if len(anon_rail) < 2:
        return before, len(cs.components)

    max_dist_deg = meters_to_degrees(max_distance_m)
    uf = UnionFind(anon_rail)

    geoms = [cs.geometry(rid) for rid in anon_rail]
    # Build STRtree over buffered geometries so we only check truly close pairs.
    buffered = [g.buffer(max_dist_deg) if g is not None else box(0, 0, 0, 0) for g in geoms]
    tree = STRtree(buffered)

    for i, ri in enumerate(anon_rail):
        geom1 = geoms[i]
        if geom1 is None:
            continue
        bearing1 = cs.bearing(ri)
        for idx in tree.query(buffered[i]):
            if idx <= i:
                continue
            rj = anon_rail[idx]
            if bearing_diff(bearing1, cs.bearing(rj)) > max_bearing_diff:
                continue
            geom2 = geoms[idx]
            if geom2 is None:
                continue
            try:
                if geom1.distance(geom2) <= max_dist_deg and \
                   cs.project_status(ri) == cs.project_status(rj):
                    uf.union(ri, rj)
            except Exception:
                continue
    groups = uf.groups()
    merge_count = sum(1 for g in groups.values() if len(g) > 1)

    if merge_count > 0:
        new_comps = dict(cs.components)
        for root, group_ids in groups.items():
            if len(group_ids) > 1:
                all_ways = []
                for gid in group_ids:
                    all_ways.extend(new_comps.pop(gid, []))
                new_comps[root] = all_ways
        cs.set_components(new_comps)

    return before, len(cs.components)


# ---------------------------------------------------------------------------
# Feature builders
# ---------------------------------------------------------------------------

def pick_representative_way(way_ids, ways):
    """Pick the most tag-rich way as the OSM link target.

    Priority: name > wikidata > ref > description > total tag count > older way ID.
    """
    def score(wid):
        tags = ways[wid]['tags']
        return (
            bool(tags.get('name')),
            bool(tags.get('wikidata')),
            bool(tags.get('ref')),
            bool(tags.get('description')),
            len(tags),
            -wid,
        )
    return max(way_ids, key=score)


def get_latest_timestamp(way_ids, ways):
    """Get latest timestamp from a set of ways."""
    latest = None
    for wid in way_ids:
        if wid in ways:
            ts = ways[wid].get('timestamp')
            if ts and (latest is None or ts > latest):
                latest = ts
    return latest


def make_relation_feature(rel_id, rel, ways):
    """Build GeoJSON feature from a relation."""
    member_geoms, member_tags, member_ids = [], [], []
    
    for wid in rel['member_way_ids']:
        if wid in ways:
            member_geoms.append(LineString(ways[wid]['coords']))
            member_tags.append(ways[wid]['tags'])
            member_ids.append(wid)
    
    if not member_geoms:
        return None
    
    try:
        merged = linemerge(member_geoms)
    except Exception:
        merged = member_geoms[0]
    
    # Start with all relation tags so no OSM data is silently dropped
    props = dict(rel['tags'])

    # Way tags fill in core transport infrastructure keys (ways carry the actual geometry)
    for wtags in member_tags:
        for k in ('construction', 'proposed', 'planned', 'highway', 'railway', 'waterway', 'aerialway', 'aeroway'):
            if k in wtags and k not in props:
                props[k] = wtags[k]

        # Also pull lifecycle prefix keys (e.g. construction:highway, planned:aerialway)
        for k in list(wtags.keys()):
            if (k.startswith('construction:') or k.startswith('proposed:') or k.startswith('planned:')) and k not in props:
                props[k] = wtags[k]
    
    # Determine transport type early so we know what rail-specific tags to pull
    transport = get_transport_type(props)
    
    # Only copy rail-specific tags if this is actually a rail project
    if broad_group(transport) == 'rail':
        for wtags in member_tags:
            for k in ('gauge', 'electrified', 'tracks', 'voltage', 'frequency'):
                if k in wtags and k not in props:
                    props[k] = wtags[k]
    
    # Relation identity tags always win (the relation is the canonical project record)
    for k in ('name', 'ref', 'wikidata', 'wikipedia', 'description', 'website',
              'source', 'opening_date', 'note', 'operator',
              'from', 'to', 'via', 'colour', 'color', 'network', 'short_name'):
        if k in rel['tags']:
            props[k] = rel['tags'][k]
    # Copy localised name tags from the relation
    for k, v in rel['tags'].items():
        if k.startswith('name:'):
            props[k] = v

    props['relation_id'] = str(rel_id)
    props['osm_ids'] = [f'way/{wid}' for wid in member_ids]
    props['osm_ids_count'] = len(member_ids)
    props['member_way_count'] = len(member_geoms)

    props['project_status'] = aggregate_project_status(get_project_status(t) for t in member_tags)
    props['transport_type'] = transport
    props['display_name'] = create_display_name(props)
    
    ts = get_latest_timestamp(member_ids, ways)
    if ts:
        props['osm_last_modified'] = ts
    
    clean_props(props)
    
    return {
        'type': 'Feature',
        'id': f'relation/{rel_id}',
        'geometry': mapping(merged),
        'properties': props,
    }


def make_orphan_features(orphan_ways):
    """Build features from orphan ways using all merge strategies."""
    cs = ComponentSet(orphan_ways)

    b, a = merge_by_topology(cs)
    print(f"  [{_ts()}] merge_by_topology:    {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = merge_by_ref(cs)
    print(f"  [{_ts()}] merge_by_ref:         {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = absorb_anonymous(cs)
    print(f"  [{_ts()}] absorb_anonymous:     {b:,} → {a:,} components ({b - a:,} absorbed)")
    b, a = merge_parallel_tracks(cs)
    print(f"  [{_ts()}] merge_parallel_tracks: {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = cluster_anonymous(cs, max_distance_km=0.2)
    print(f"  [{_ts()}] cluster_anonymous:    {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = merge_by_name_proximity(cs, max_distance_m=100)
    print(f"  [{_ts()}] merge_by_name_prox:   {b:,} → {a:,} components ({b - a:,} merged)")

    features = []
    for rep_id, way_ids in cs.components.items():
        ways_data = [orphan_ways[wid] for wid in way_ids]
        tags_list = [w['tags'] for w in ways_data]
        
        try:
            merged = linemerge([LineString(w['coords']) for w in ways_data])
        except Exception:
            merged = LineString(ways_data[0]['coords'])
        
        props = {}
        for w in ways_data:
            props.update(w['tags'])
        # Use best_name_from_tags so the longest/most descriptive name wins
        best = best_name_from_tags(tags_list)
        if best:
            props['name'] = best

        # Clean up historic railway tags on non-rail projects
        transport = get_transport_type(props)
        if broad_group(transport) != 'rail':
            for k in ('gauge', 'electrified', 'tracks', 'voltage', 'frequency'):
                props.pop(k, None)
                props.pop(f'railway:{k}', None)
        
        props['osm_ids'] = [f'way/{wid}' for wid in way_ids]
        props['osm_ids_count'] = len(way_ids)
        props['osm_way_id'] = pick_representative_way(way_ids, orphan_ways)

        props['project_status'] = cs.project_status(rep_id)
        props['transport_type'] = transport
        props['display_name'] = create_display_name(props, tags_list=tags_list)
        
        ts = get_latest_timestamp(way_ids, orphan_ways)
        if ts:
            props['osm_last_modified'] = ts
        
        clean_props(props)
        
        features.append({
            'type': 'Feature',
            'id': f'way/{props["osm_way_id"]}',
            'geometry': mapping(merged),
            'properties': props,
        })
    
    return features


# ---------------------------------------------------------------------------
# Relation processing
# ---------------------------------------------------------------------------

def relation_priority(rel):
    """Sortable tuple for choosing canonical relation when overlapping."""
    tags = rel['tags']
    type_score = {'site': 3, 'route': 2}.get(tags.get('type', ''), 1 if tags.get('type') else 0)
    route_score = 2 if tags.get('route') == 'tracks' else (1 if tags.get('route') else 0)
    has_ref = 1 if tags.get('ref', '').strip() else 0
    has_name = 1 if tags.get('name', '').strip() else 0
    size_score = -len(rel.get('kept_member_way_ids', ()))
    return (type_score, route_score, has_ref, has_name, size_score, -int(rel['id']))


def prune_overlapping_relations(relations, ways, overlap_threshold=0.95):
    """Remove heavily overlapping relation duplicates."""
    rel_items = []
    for rel_id, rel in relations.items():
        kept = [wid for wid in rel['member_way_ids'] if wid in ways]
        if kept:
            rel_items.append({
                'id': rel_id, 'tags': rel['tags'],
                'member_way_ids': rel['member_way_ids'],
                'kept_member_way_ids': kept, 'way_set': set(kept),
            })
    
    if len(rel_items) <= 1:
        return {r['id']: {'tags': r['tags'], 'member_way_ids': r['member_way_ids']} for r in rel_items}
    
    # Only relations sharing at least one member way can overlap: index ways to
    # relation positions so each relation is compared against its neighbors only.
    way_to_idxs = defaultdict(list)
    for idx, item in enumerate(rel_items):
        for wid in item['way_set']:
            way_to_idxs[wid].append(idx)

    neighbors = defaultdict(set)
    for idxs in way_to_idxs.values():
        for pos, i in enumerate(idxs):
            neighbors[i].update(idxs[pos+1:])

    dropped = set()
    for i, a in enumerate(rel_items):
        if a['id'] in dropped:
            continue
        for j in sorted(neighbors[i]):
            b = rel_items[j]
            if b['id'] in dropped:
                continue
            inter = len(a['way_set'] & b['way_set'])
            overlap = inter / min(len(a['way_set']), len(b['way_set']))
            if overlap >= overlap_threshold:
                dropped.add(b['id'] if relation_priority(a) >= relation_priority(b) else a['id'])
                if a['id'] in dropped:
                    break
    
    return {r['id']: {'tags': r['tags'], 'member_way_ids': r['member_way_ids']} 
            for r in rel_items if r['id'] not in dropped}


def assign_unique_relation_members(relations, ways):
    """Ensure each way belongs to at most one relation."""
    prepared = {}
    for rel_id, rel in relations.items():
        kept = [wid for wid in rel['member_way_ids'] if wid in ways]
        if kept:
            prepared[rel_id] = {
                'id': rel_id, 'tags': rel['tags'],
                'member_way_ids': rel['member_way_ids'],
                'kept_member_way_ids': kept,
                'priority': relation_priority({'id': rel_id, 'tags': rel['tags'], 'kept_member_way_ids': kept}),
            }
    
    if not prepared:
        return {}
    
    # Assign each way to highest-priority relation
    owner = {}
    for rel_id, rel in prepared.items():
        score = rel['priority']
        for wid in rel['kept_member_way_ids']:
            if wid not in owner or score > owner[wid][1]:
                owner[wid] = (rel_id, score)
    
    # Rebuild with only owned ways
    result = {}
    for rel_id, rel in prepared.items():
        owned = [wid for wid in rel['member_way_ids'] if wid in ways and owner.get(wid, (None,))[0] == rel_id]
        if owned:
            result[rel_id] = {'tags': rel['tags'], 'member_way_ids': owned}

    return result


def _relation_geometry(member_way_ids, ways):
    """Merged geometry of a relation's kept member ways, or None."""
    lines = [LineString(ways[wid]['coords'])
             for wid in member_way_ids
             if wid in ways and len(ways[wid]['coords']) >= 2]
    if not lines:
        return None
    try:
        return linemerge(lines)
    except Exception:
        return lines[0]


def _relation_broad_type(member_way_ids, ways):
    """Majority broad transport group across a relation's member ways."""
    counts = defaultdict(int)
    for wid in member_way_ids:
        if wid in ways:
            counts[broad_group(get_transport_type(ways[wid]['tags']))] += 1
    return max(counts.items(), key=lambda kv: kv[1])[0] if counts else 'other'


def _relation_status(member_way_ids, ways):
    """Aggregated project status across a relation's member ways."""
    return aggregate_project_status(
        get_project_status(ways[wid]['tags']) for wid in member_way_ids if wid in ways)


def merge_coincident_relations(relations, ways, buffer_m=25,
                               overlap_threshold=0.8, length_ratio_min=0.6):
    """Merge route relations that trace the same physical line.

    The common case is a tram/bus/rail line modelled as two directional route
    relations that share no member ways (each direction has its own ways) and
    carry no parent route_master, so neither prune_overlapping_relations (which
    keys on shared ways) nor the orphan merge strategies (which never see
    relation members) ever combine them.

    Two relations merge when, for the same broad transport type and project
    status, each one's geometry lies mostly within buffer_m of the other
    (>= overlap_threshold of its length) and their lengths are comparable
    (>= length_ratio_min). The bidirectional overlap plus similar-length test
    targets directional pairs while rejecting different lines that merely share
    a trunk corridor (the longer line's overlap fraction stays low). Conflicting
    ref tags block the merge as a safety net for distinct lines sharing tracks.
    """
    if len(relations) < 2:
        return relations

    info = {}
    for rel_id, rel in relations.items():
        member_ids = rel['member_way_ids']
        g = _relation_geometry(member_ids, ways)
        if g is None or g.is_empty or g.length == 0:
            continue
        info[rel_id] = {
            'geom': g,
            'length': g.length,
            'btype': _relation_broad_type(member_ids, ways),
            'status': _relation_status(member_ids, ways),
            'ref': rel['tags'].get('ref', '').strip(),
        }

    if len(info) < 2:
        return relations

    buf_deg = meters_to_degrees(buffer_m)

    by_group = defaultdict(list)
    for rel_id, d in info.items():
        by_group[(d['btype'], d['status'])].append(rel_id)

    uf = UnionFind(list(info.keys()))
    for rel_ids in by_group.values():
        if len(rel_ids) < 2:
            continue
        bufs = [info[rid]['geom'].buffer(buf_deg) for rid in rel_ids]
        tree = STRtree(bufs)
        for i, ri in enumerate(rel_ids):
            gi, li, refi = info[ri]['geom'], info[ri]['length'], info[ri]['ref']
            for idx in tree.query(bufs[i]):
                if idx <= i:
                    continue
                rj = rel_ids[idx]
                gj, lj, refj = info[rj]['geom'], info[rj]['length'], info[rj]['ref']
                if refi and refj and refi != refj:
                    continue
                if min(li, lj) / max(li, lj) < length_ratio_min:
                    continue
                try:
                    oi = gi.intersection(bufs[idx]).length / li
                    oj = gj.intersection(bufs[i]).length / lj
                except Exception:
                    continue
                if min(oi, oj) >= overlap_threshold:
                    uf.union(ri, rj)

    groups = uf.groups()
    merged_groups = sum(1 for g in groups.values() if len(g) > 1)
    if merged_groups == 0:
        return relations

    # Relations with no usable geometry never entered the union-find; pass them
    # through untouched so nothing is silently dropped.
    result = {rid: rel for rid, rel in relations.items() if rid not in info}
    for root, members in groups.items():
        if len(members) == 1:
            rid = members[0]
            result[rid] = relations[rid]
            continue
        # Winner (canonical id/tags) is the highest-priority relation; lower
        # priority relations fill in any identity tags it is missing.
        ordered = sorted(
            members,
            key=lambda rid: relation_priority({
                'id': rid, 'tags': relations[rid]['tags'],
                'kept_member_way_ids': [w for w in relations[rid]['member_way_ids'] if w in ways],
            }),
        )
        winner = ordered[-1]
        combined_tags = {}
        all_member_ids = []
        for rid in ordered:
            combined_tags.update(relations[rid]['tags'])
            all_member_ids.extend(relations[rid]['member_way_ids'])
        result[winner] = {'tags': combined_tags, 'member_way_ids': all_member_ids}

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_features(ways, relations):
    """Build all features from ways and relations."""
    before_prune = len(relations)
    relations = prune_overlapping_relations(relations, ways)
    print(f"  [{_ts()}] prune_overlapping_relations: {before_prune:,} → {len(relations):,} relations")
    relations = assign_unique_relation_members(relations, ways)
    print(f"  [{_ts()}] assign_unique_relation_members: {len(relations):,} relations with owned ways")
    before_coincident = len(relations)
    relations = merge_coincident_relations(relations, ways)
    print(f"  [{_ts()}] merge_coincident_relations: {before_coincident:,} → {len(relations):,} relations "
          f"({before_coincident - len(relations):,} directional pairs merged)")

    features = []
    processed_ways = set()

    for rel_id, rel in relations.items():
        feat = make_relation_feature(rel_id, rel, ways)
        if feat:
            processed_ways.update(wid for wid in rel['member_way_ids'] if wid in ways)
            features.append(feat)
    print(f"  [{_ts()}] relation features built: {len(features):,}")

    orphans = {wid: way for wid, way in ways.items() if wid not in processed_ways}
    features.extend(make_orphan_features(orphans))

    return features


def _fmt(secs):
    return f"{int(secs // 60)}m{int(secs % 60):02d}s"


def _ts():
    return datetime.now().strftime('%H:%M:%S')


def main():
    args = _parse_args()
    WAYS_FILE = args.ways_file
    SOURCE_FILE = args.source_file
    OUTPUT_FILE = args.output
    t_total = time.time()

    print(f"[linear] [{_ts()}] Pass 1: Reading way geometries from {WAYS_FILE}...")
    t = time.time()
    way_handler = WayGeometryHandler()
    way_handler.apply_file(WAYS_FILE, locations=True)
    print(f"[linear] [{_ts()}] Pass 1 done in {_fmt(time.time() - t)}, {len(way_handler.ways):,} renderable proposed/construction ways")
    if way_handler.unrenderable_way_ids:
        print(f"[linear] [{_ts()}] Pass 1 skipped {len(way_handler.unrenderable_way_ids):,} candidate ways without usable geometry")

    if not way_handler.ways:
        print("[linear] ERROR: No ways found.")
        return

    print(f"\n[linear] [{_ts()}] Pass 2: Scanning relations in {SOURCE_FILE}...")
    t = time.time()
    rel_handler = RelationHandler(way_handler.ways, way_handler.unrenderable_way_ids)
    rel_handler.apply_file(SOURCE_FILE)
    relations = rel_handler.relations
    relation_count = len(relations)
    del rel_handler
    way_handler.unrenderable_way_ids.clear()
    print(f"[linear] [{_ts()}] Pass 2 done in {_fmt(time.time() - t)}, {relation_count:,} route relations found")

    print(f"\n[linear] [{_ts()}] Building GeoJSON features...")
    t = time.time()
    features = build_features(way_handler.ways, relations)
    print(f"[linear] [{_ts()}] Build done in {_fmt(time.time() - t)}")

    in_rel = sum(1 for f in features if f['id'].startswith('relation/'))
    orphan = sum(1 for f in features if f['id'].startswith('way/'))
    print(f"  Relation features: {in_rel:,}")
    print(f"  Orphan way features (connected components): {orphan:,}")
    print(f"  Total: {len(features):,}")

    # Transport type breakdown
    type_counts = defaultdict(int)
    for f in features:
        type_counts[f['properties'].get('transport_type', 'unknown')] += 1
    print("  transport_type breakdown:")
    for t_type, n in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"    {t_type:20s} {n:,}")

    print(f"\n[linear] [{_ts()}] Writing {OUTPUT_FILE}...")
    t = time.time()
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f, ensure_ascii=False, separators=(',', ':'))
    print(f"[linear] [{_ts()}] Write done in {_fmt(time.time() - t)}")

    print("\n[linear] Sample features:")
    for feat in features[:8]:
        props = feat['properties']
        print(f"  [{props.get('project_status', '?'):20s}] [{props.get('transport_type', '?'):12s}] "
              f"{(props.get('display_name') or 'Unnamed')[:55]}  ({feat['id']})")

    print(f"\n[linear] [{_ts()}] Done! Total: {_fmt(time.time() - t_total)}")


if __name__ == '__main__':
    main()
