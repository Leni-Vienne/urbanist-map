#!/usr/bin/env python3
"""
Extract proposed/construction linear transport features — topology-based orphan grouping.

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
from datetime import datetime, timedelta, timezone
from shapely.geometry import LineString, mapping, box
from shapely.ops import linemerge
from shapely.strtree import STRtree

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STALE_THRESHOLD_YEARS = 3  # Features older than this are filtered (unless named)

def _parse_args():
    parser = argparse.ArgumentParser(description='Extract proposed/construction linear transport features from OSM.')
    parser.add_argument('--ways-file', default='germany-latest_proposed_linear.osm.pbf',
                        help='Filtered PBF containing only proposed/construction ways')
    parser.add_argument('--source-file', default='germany-latest.osm.pbf',
                        help='Original source PBF (used for relation scanning)')
    parser.add_argument('--output', default='germany-latest_proposed_linear.geojson',
                        help='Output GeoJSON file path')
    return parser.parse_args()

_args = _parse_args()
WAYS_FILE = _args.ways_file
SOURCE_FILE = _args.source_file
OUTPUT_FILE = _args.output

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
    # Road family
    'road': ('motorway', 'trunk', 'primary', 'secondary', 'tertiary',
             'residential', 'unclassified', 'service', 'living_street', 'road'),
    'bus': ('bus_guideway',),
    # Active mobility
    'bike': ('cycleway', 'bicycle'),
    'pedestrian': ('pedestrian', 'footway', 'path', 'steps'),
    # Water
    'waterway': ('canal', 'river', 'stream'),
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
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]
    
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
    return math.sqrt((lon_gap * 85) ** 2 + (lat_gap * 111) ** 2)


def compute_bearing(coords):
    """Compute dominant bearing (0-180°) from start to end of linestring."""
    if len(coords) < 2:
        return 0
    dx = coords[-1][0] - coords[0][0]
    dy = coords[-1][1] - coords[0][1]
    if abs(dx) < 1e-9 and abs(dy) < 1e-9 and len(coords) >= 2:
        dx = coords[1][0] - coords[0][0]
        dy = coords[1][1] - coords[0][1]
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
    # Check construction=/proposed= first
    for key in ('construction', 'proposed'):
        val = tags.get(key, '')
        if val and val not in ('yes', 'no') and val in _VALUE_TO_TYPE:
            return _VALUE_TO_TYPE[val]
    
    # Check boolean flags for specific rail types
    for rail_type in ('subway', 'tram', 'light_rail', 'narrow_gauge', 'monorail', 'miniature'):
        if tags.get(rail_type) == 'yes':
            return _VALUE_TO_TYPE[rail_type]

    # Check primary keys
    for key, fallback in [('aerialway', 'cable_car'), ('railway', 'rail'), 
                          ('highway', 'road'), ('waterway', 'waterway')]:
        val = tags.get(key, '')
        if val:
            # For X=proposed/construction, check proposed:X or construction:X
            if val in ('proposed', 'construction'):
                specific = tags.get(f'proposed:{key}', '') or tags.get(f'construction:{key}', '')
                if specific in _VALUE_TO_TYPE:
                    return _VALUE_TO_TYPE[specific]
            if val in _VALUE_TO_TYPE:
                return _VALUE_TO_TYPE[val]
            return fallback
    
    return 'rail'  # fallback


def broad_group(transport_type):
    """Map transport type to broad family (rail/road/active/aerial/waterway)."""
    return _TYPE_TO_GROUP.get(transport_type, 'other')


def get_project_status(tags):
    """Return 'under_construction' or 'proposed'."""
    if any(tags.get(k) == 'construction' for k in ('railway', 'highway', 'waterway', 'aerialway')):
        return 'under_construction'
    if tags.get('construction', '') not in ('', 'no'):
        return 'under_construction'
    return 'proposed'


def is_transport_way(tags):
    """Return True if way represents proposed/construction transport infrastructure."""
    # Explicit status on primary keys
    if any(tags.get(k) in ('proposed', 'construction') 
           for k in ('railway', 'highway', 'waterway', 'aerialway')):
        return True
    
    # Exclude buildings/landuse with ambiguous construction= tags
    if 'landuse' in tags or tags.get('building', 'no') != 'no':
        return False
    
    return tags.get('construction', '') in TRANSPORT_VALUES or \
           tags.get('proposed', '') in TRANSPORT_VALUES


# ---------------------------------------------------------------------------
# Date filtering
# ---------------------------------------------------------------------------

def get_stale_threshold():
    """Return datetime threshold for stale features."""
    return datetime.now(timezone.utc) - timedelta(days=STALE_THRESHOLD_YEARS * 365)


def is_stale(timestamp_str, threshold):
    """Check if timestamp is older than threshold."""
    if not timestamp_str:
        return False
    try:
        ts = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts < threshold
    except Exception:
        return False


def has_name(tags):
    """Check if tags contain a name."""
    return bool(tags.get('name', '').strip())


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
    # Collect all names and pick the best one
    names = []
    for tags in tags_list:
        name = tags.get('name', '').strip()
        if name:
            names.append(name)
    
    if names:
        # Prefer longer names (more descriptive)
        names_sorted = sorted(names, key=len, reverse=True)
        return names_sorted[0]
    
    # Try to extract title from wikipedia tag (language-agnostic)
    for tags in tags_list:
        wiki = tags.get('wikipedia', '').strip()
        if wiki and ':' in wiki:
            # Strip language prefix (e.g., "de:", "en:", "fr:") and convert underscores
            wiki_title = wiki.split(':', 1)[1].replace('_', ' ')
            if wiki_title:
                return wiki_title
    
    # Fall back to description, but skip very short ones (less than 4 chars)
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
    
    if props.get('description', '').strip():
        cleaned, _ = clean_description(props['description'])
        cleaned = re.sub(r'\s*\([^)]*\)\s*$', '', cleaned).strip()
        if cleaned:
            return cleaned
    
    from_tag, to_tag = props.get('from', '').strip(), props.get('to', '').strip()
    if from_tag and to_tag:
        ref = props.get('ref', '').strip()
        return f"{from_tag} – {to_tag} (line {ref})" if ref else f"{from_tag} – {to_tag}"
    
    return None


# ---------------------------------------------------------------------------
# OSM handlers
# ---------------------------------------------------------------------------

class WayGeometryHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = {}

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
        except Exception:
            pass


class RelationHandler(osmium.SimpleHandler):
    def __init__(self, proposed_way_ids):
        super().__init__()
        self.proposed_way_ids = proposed_way_ids
        self.relations = {}

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        member_way_ids = [m.ref for m in r.members if m.type == 'w']
        if any(wid in self.proposed_way_ids for wid in member_way_ids):
            self.relations[r.id] = {'tags': tags, 'member_way_ids': member_way_ids}


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
            construction_count = sum(
                1 for wid in self.components[rep_id]
                if get_project_status(self.ways[wid]['tags']) == 'under_construction'
            )
            proposed_count = len(self.components[rep_id]) - construction_count
            self._cache[key] = 'under_construction' if construction_count > proposed_count else 'proposed'
        return self._cache[key]

    def geometry(self, rep_id):
        key = (rep_id, 'geom')
        if key not in self._cache:
            lines = [LineString(self.ways[wid]['coords']) 
                    for wid in self.components[rep_id] 
                    if wid in self.ways and len(self.ways[wid]['coords']) >= 2]
            try:
                self._cache[key] = linemerge(lines) if lines else None
            except:
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
                # Only merge by name for major transit (not road/active)
                if bt not in ('road', 'active'):
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
    for wid, way in cs.ways.items():
        endpoint_to_ways[snap_coord(way['coords'][0])].add(wid)
        endpoint_to_ways[snap_coord(way['coords'][-1])].add(wid)

    uf = UnionFind(cs.ways.keys())
    for wids in endpoint_to_ways.values():
        wlist = list(wids)
        for i in range(1, len(wlist)):
            # Only merge same broad type and same project status
            if broad_group(get_transport_type(cs.ways[wlist[0]]['tags'])) == \
               broad_group(get_transport_type(cs.ways[wlist[i]]['tags'])) and \
               get_project_status(cs.ways[wlist[0]]['tags']) == \
               get_project_status(cs.ways[wlist[i]]['tags']):
                uf.union(wlist[0], wlist[i])

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

    # Rebuild components
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
    """Absorb anonymous components into nearest named component of exact same type."""
    before = len(cs.components)
    named = [rid for rid in cs.components if not cs.is_anonymous(rid)]
    anonymous = [rid for rid in cs.components if cs.is_anonymous(rid)]

    if not named or not anonymous:
        return before, len(cs.components)

    # Group named components by (transport_type, project_status) and build one STRtree per group.
    pad_lon = max_distance_km / 85
    pad_lat = max_distance_km / 111
    named_by_type_status = defaultdict(list)
    for nid in named:
        named_by_type_status[(cs.transport_type(nid), cs.project_status(nid))].append(nid)

    trees = {}   # (transport_type, project_status) -> STRtree
    idx_maps = {}  # (transport_type, project_status) -> list of rep_ids (index matches tree)
    for key, nids in named_by_type_status.items():
        geoms = [_bbox_to_box(cs.bbox(nid)) for nid in nids]
        trees[key] = STRtree(geoms)
        idx_maps[key] = nids

    absorptions = {}
    for uid in anonymous:
        uid_key = (cs.transport_type(uid), cs.project_status(uid))
        if uid_key not in trees:
            continue
        query_box = _expand_box(cs.bbox(uid), pad_lon, pad_lat)
        candidates = trees[uid_key].query(query_box)
        best_target, best_dist = None, float('inf')
        for idx in candidates:
            nid = idx_maps[uid_key][idx]
            d = bbox_distance_km(cs.bbox(uid), cs.bbox(nid))
            if d < best_dist:
                best_dist, best_target = d, nid
        if best_target and best_dist <= max_distance_km:
            absorptions[uid] = best_target

    new_comps = dict(cs.components)
    for uid, target in absorptions.items():
        new_comps[target] = new_comps[target] + new_comps.pop(uid)
    cs.set_components(new_comps)
    return before, len(cs.components)



def cluster_anonymous(cs, max_distance_km=0.2):
    """Merge anonymous components of the same broad type that are physically close.
    Useful for fragmented interchanges or station tracks."""
    anonymous = [rid for rid in cs.components if cs.is_anonymous(rid)]

    if len(anonymous) < 2:
        return 0

    pad_lon = max_distance_km / 85
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
            query_box = _expand_box(cs.bbox(ri), pad_lon, pad_lat)
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
        
    return merge_count


def merge_parallel_tracks(cs, max_distance_m=10, max_bearing_diff=15):
    """Merge anonymous parallel rail tracks (last resort)."""
    anon_rail = [rid for rid in cs.components
                 if cs.is_anonymous(rid) and cs.broad_type(rid) == 'rail']

    if len(anon_rail) < 2:
        return 0

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
            except:
                continue
    
    # Count merges and apply
    groups = uf.groups()
    merge_count = sum(1 for g in groups.values() if len(g) > 1)
    components_merged = sum(len(g) for g in groups.values() if len(g) > 1)
    
    if merge_count > 0:
        new_comps = dict(cs.components)
        for root, group_ids in groups.items():
            if len(group_ids) > 1:
                all_ways = []
                for gid in group_ids:
                    all_ways.extend(new_comps.pop(gid, []))
                new_comps[root] = all_ways
        cs.set_components(new_comps)
        
        print(f"\nParallel track merging (anonymous rail, <{max_distance_m}m, <{max_bearing_diff}° bearing diff):")
        print(f"  Merged {components_merged} components into {merge_count} groups")
        print(f"  Net reduction: {components_merged - merge_count} features")
    
    return components_merged - merge_count


# ---------------------------------------------------------------------------
# Feature builders
# ---------------------------------------------------------------------------

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
    except:
        merged = member_geoms[0]
    
    # Build properties primarily from member ways (the actual proposed/construction features)
    props = {}
    for wtags in member_tags:
        # Pull core transport infrastructure tags from the ways
        for k in ('construction', 'proposed', 'highway', 'railway', 'waterway', 'aerialway'):
            if k in wtags and k not in props:
                props[k] = wtags[k]
        
        # Pull specific proposed/construction types (e.g. construction:highway)
        for k in list(wtags.keys()):
            if (k.startswith('construction:') or k.startswith('proposed:')) and k not in props:
                props[k] = wtags[k]
    
    # Determine the transport type early so we know what tags are relevant
    temp_props = dict(props)
    # Also check relation tags for construction/proposed
    for k in ('construction', 'proposed'):
        if k in rel['tags'] and k not in temp_props:
            temp_props[k] = rel['tags'][k]
    transport = get_transport_type(temp_props)
    
    # Only copy rail-specific tags if this is actually a rail project
    if broad_group(transport) == 'rail':
        for wtags in member_tags:
            for k in ('gauge', 'electrified', 'tracks', 'voltage', 'frequency'):
                if k in wtags and k not in props:
                    props[k] = wtags[k]
    
    # Only copy select relation tags that are relevant for the project
    # Skip historic/unrelated tags like route=railway on a proposed cycleway
    relevant_rel_tags = ('name', 'ref', 'description', 'website', 'source', 
                         'wikidata', 'wikipedia', 'state', 'opening_date',
                         'construction', 'proposed', 'note', 'operator')
    for k in relevant_rel_tags:
        if k in rel['tags'] and k not in props:
            props[k] = rel['tags'][k]
    
    props['relation_id'] = str(rel_id)
    props['osm_ids'] = [f'way/{wid}' for wid in member_ids]
    props['osm_ids_count'] = len(member_ids)
    props['member_way_count'] = len(member_geoms)
    
    # Determine status
    is_construction = rel['tags'].get('state') == 'construction'
    if not is_construction:
        is_construction = any(get_project_status(t) == 'under_construction' for t in member_tags)
    props['project_status'] = 'under_construction' if is_construction else 'proposed'
    props['transport_type'] = get_transport_type(props)
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
    print(f"  merge_by_topology:    {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = merge_by_ref(cs)
    print(f"  merge_by_ref:         {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = absorb_anonymous(cs)
    print(f"  absorb_anonymous:     {b:,} → {a:,} components ({b - a:,} absorbed)")
    n = merge_parallel_tracks(cs)
    print(f"  merge_parallel_tracks: {n:,} groups merged")
    n = cluster_anonymous(cs, max_distance_km=0.2)
    print(f"  cluster_anonymous:    {n:,} groups merged")
    
    features = []
    for rep_id, way_ids in cs.components.items():
        ways_data = [orphan_ways[wid] for wid in way_ids]
        tags_list = [w['tags'] for w in ways_data]
        
        try:
            merged = linemerge([LineString(w['coords']) for w in ways_data])
        except:
            merged = LineString(ways_data[0]['coords'])
        
        props = {}
        for w in ways_data:
            props.update(w['tags'])
            
        # Clean up historic railway tags on non-rail projects
        transport = get_transport_type(props)
        if broad_group(transport) != 'rail':
            for k in ('gauge', 'electrified', 'tracks', 'voltage', 'frequency'):
                props.pop(k, None)
                props.pop(f'railway:{k}', None)
        
        props['osm_ids'] = [f'way/{wid}' for wid in way_ids]
        props['osm_ids_count'] = len(way_ids)
        props['osm_way_id'] = way_ids[0]
        props['project_status'] = 'under_construction' if any(
            get_project_status(w['tags']) == 'under_construction' for w in ways_data
        ) else 'proposed'
        props['transport_type'] = transport
        props['display_name'] = create_display_name(props, tags_list=tags_list)
        
        ts = get_latest_timestamp(way_ids, orphan_ways)
        if ts:
            props['osm_last_modified'] = ts
        
        clean_props(props)
        
        features.append({
            'type': 'Feature',
            'id': f'way/{min(way_ids)}',
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
    
    dropped = set()
    for i, a in enumerate(rel_items):
        if a['id'] in dropped:
            continue
        for b in rel_items[i+1:]:
            if b['id'] in dropped:
                continue
            inter = len(a['way_set'] & b['way_set'])
            if inter == 0:
                continue
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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_features(ways, relations):
    """Build all features from ways and relations."""
    relations = prune_overlapping_relations(relations, ways)
    relations = assign_unique_relation_members(relations, ways)
    
    features = []
    processed_ways = set()
    
    for rel_id, rel in relations.items():
        feat = make_relation_feature(rel_id, rel, ways)
        if feat:
            processed_ways.update(wid for wid in rel['member_way_ids'] if wid in ways)
            features.append(feat)
    
    orphans = {wid: way for wid, way in ways.items() if wid not in processed_ways}
    features.extend(make_orphan_features(orphans))
    
    return features


def filter_by_date(features, threshold):
    """Filter out stale features without names."""
    kept, stats = [], {'recent': 0, 'named': 0, 'no_ts': 0, 'filtered': 0}
    
    for f in features:
        props = f['properties']
        ts = props.get('osm_last_modified')
        
        if not ts:
            stats['no_ts'] += 1
            kept.append(f)
        elif not is_stale(ts, threshold):
            stats['recent'] += 1
            kept.append(f)
        elif has_name(props):
            stats['named'] += 1
            kept.append(f)
        else:
            stats['filtered'] += 1
    
    return kept, stats


def _fmt(secs):
    return f"{int(secs // 60)}m{int(secs % 60):02d}s"


def main():
    t_total = time.time()

    print(f"[linear] Pass 1: Reading way geometries from {WAYS_FILE}...")
    t = time.time()
    way_handler = WayGeometryHandler()
    way_handler.apply_file(WAYS_FILE, locations=True)
    print(f"[linear] Pass 1 done in {_fmt(time.time() - t)} — {len(way_handler.ways):,} proposed/construction ways")

    if not way_handler.ways:
        print("[linear] ERROR: No ways found.")
        return

    print(f"\n[linear] Pass 2: Scanning relations in {SOURCE_FILE}...")
    t = time.time()
    rel_handler = RelationHandler(set(way_handler.ways.keys()))
    rel_handler.apply_file(SOURCE_FILE)
    print(f"[linear] Pass 2 done in {_fmt(time.time() - t)} — {len(rel_handler.relations):,} route relations found")

    print("\n[linear] Building GeoJSON features...")
    t = time.time()
    features = build_features(way_handler.ways, rel_handler.relations)
    print(f"[linear] Build done in {_fmt(time.time() - t)}")

    in_rel = sum(1 for f in features if f['id'].startswith('relation/'))
    orphan = sum(1 for f in features if f['id'].startswith('way/'))
    print(f"  Relation features: {in_rel:,}")
    print(f"  Orphan way features (connected components): {orphan:,}")
    print(f"  Total before filtering: {len(features):,}")

    # Date filtering temporarily disabled for statistics gathering
    print(f"\n[linear] Date filtering: DISABLED (keeping all {len(features):,} features)")

    # Transport type breakdown
    type_counts = defaultdict(int)
    for f in features:
        type_counts[f['properties'].get('transport_type', 'unknown')] += 1
    print("  transport_type breakdown:")
    for t_type, n in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"    {t_type:20s} {n:,}")

    print(f"\n[linear] Writing {OUTPUT_FILE}...")
    t = time.time()
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f, ensure_ascii=False, separators=(',', ':'))
    print(f"[linear] Write done in {_fmt(time.time() - t)}")

    print("\n[linear] Sample features:")
    for feat in features[:8]:
        props = feat['properties']
        print(f"  [{props.get('project_status', '?'):20s}] [{props.get('transport_type', '?'):12s}] "
              f"{(props.get('display_name') or 'Unnamed')[:55]}  ({feat['id']})")

    print(f"\n[linear] Done! Total: {_fmt(time.time() - t_total)}")


if __name__ == '__main__':
    main()
