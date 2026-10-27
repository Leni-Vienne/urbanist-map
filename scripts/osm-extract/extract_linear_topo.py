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
import argparse
import osmium
from collections import defaultdict
from itertools import combinations
from shapely.affinity import scale
from shapely.geometry import LineString, MultiLineString, mapping, box
from shapely.ops import linemerge
from shapely.strtree import STRtree

from osm_log import get_logger, timed_step
from osm_io import write_feature_collection
from osm_policy import (
    aggregate_project_status,
    broad_group,
    get_linear_project_status,
    get_transport_type,
    is_linear_project_relation,
    is_transport_way,
)


LOGGER = get_logger('linear')

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


URL_RE = re.compile(r'https?://\S+')
LOCAL_NAME_KEY_RE = re.compile(r'name:[a-z]{2,3}(?:-[A-Za-z0-9]+)*')
PROJECT_IDENTITY_KEYS = {
    'name', 'ref', 'wikidata', 'official_ref',
    'construction:ref', 'proposed:ref', 'planned:ref',
}


def identity_tags(tags):
    """Explicit project identities, including localized names."""
    for key, value in tags.items():
        if key in PROJECT_IDENTITY_KEYS or LOCAL_NAME_KEY_RE.fullmatch(key):
            value = value.strip()
            if value:
                yield key, value


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
    """Convert metres to latitude degrees; longitude also needs latitude scaling."""
    return meters / 111320


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
        member_way_ids = [m.ref for m in r.members if m.type == 'w']
        candidate_member_count = sum(
            wid in self.candidate_ways or wid in self.unrenderable_way_ids
            for wid in member_way_ids
        )
        if not is_linear_project_relation(tags, candidate_member_count, len(member_way_ids)):
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
        self._way_geometries = {}
        self.components = {}  # rep_id -> [way_ids]
        self._cache = {}  # (rep_id, prop) -> value
    
    def set_components(self, components):
        unchanged = {
            rep_id for rep_id, way_ids in components.items()
            if self.components.get(rep_id) == way_ids
        }
        self._cache = {
            key: value for key, value in self._cache.items()
            if key[0] in unchanged
        }
        self.components = components
    
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
                if any(identity_tags(tags)) or tags.get('description', '').strip():
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
                get_linear_project_status(self.ways[wid]['tags']) for wid in self.components[rep_id])
        return self._cache[key]

    def way_geometry(self, way_id):
        if way_id not in self._way_geometries:
            self._way_geometries[way_id] = LineString(self.ways[way_id]['coords'])
        return self._way_geometries[way_id]

    def geometry(self, rep_id):
        key = (rep_id, 'geom')
        if key not in self._cache:
            lines = [self.way_geometry(wid)
                    for wid in self.components[rep_id] 
                    if wid in self.ways and len(self.ways[wid]['coords']) >= 2]
            try:
                # Passing the collection preserves cached LineStrings;
                # linemerge(list) extracts and rebuilds their coordinates.
                self._cache[key] = linemerge(MultiLineString(lines)) if lines else None
            except Exception:
                self._cache[key] = lines[0] if lines else None
        return self._cache[key]


# ---------------------------------------------------------------------------
# Merge strategies
# ---------------------------------------------------------------------------

def _merge_components(cs, pairs):
    """Merge candidate pairs without changing type, status, or project identity."""
    before = len(cs.components)
    uf = UnionFind(cs.components)
    identities = {}
    for rid, way_ids in cs.components.items():
        identity = defaultdict(set)
        for wid in way_ids:
            for key, value in identity_tags(cs.ways[wid]['tags']):
                identity[key].add(value)
        if identity:
            identities[rid] = identity

    for ri, rj, max_distance_m in pairs:
        a, b = uf.find(ri), uf.find(rj)
        if a == b:
            continue
        if (cs.transport_type(ri), cs.project_status(ri)) != (
                cs.transport_type(rj), cs.project_status(rj)):
            continue
        left, right = identities.get(a, {}), identities.get(b, {})
        # Check whole groups: an unidentified segment must not bridge two
        # incompatible names/refs, even if each original pair looked compatible.
        if any(left[key] != right[key] for key in left.keys() & right.keys()):
            continue
        if max_distance_m is not None:
            geom, other = cs.geometry(ri), cs.geometry(rj)
            # Use the same local scale for both lines, after the cheap checks.
            latitude = (min(geom.bounds[1], other.bounds[1]) +
                        max(geom.bounds[3], other.bounds[3])) / 2
            lon_scale = math.cos(math.radians(latitude))
            projected = scale(geom, xfact=lon_scale, origin=(0, 0))
            other_projected = scale(other, xfact=lon_scale, origin=(0, 0))
            if projected.distance(other_projected) > meters_to_degrees(max_distance_m):
                continue
        uf.union(a, b)
        if left:
            identities.setdefault(b, {}).update(identities.pop(a))

    components = defaultdict(list)
    for rid, way_ids in cs.components.items():
        components[uf.find(rid)].extend(way_ids)
    cs.set_components(dict(components))
    return before, len(cs.components)


def _nearby_candidates(cs, rep_ids, max_distance_m):
    """Find envelope candidates; the merge check measures actual line distance."""
    rep_ids = sorted(rep_ids)
    if len(rep_ids) < 2:
        return
    entries = [(rid, cs.geometry(rid)) for rid in rep_ids]
    entries = [(rid, geom) for rid, geom in entries if geom is not None and not geom.is_empty]
    geoms = [geom for _, geom in entries]
    tree = STRtree(geoms)
    pad_lat = meters_to_degrees(max_distance_m)
    for i, (ri, geom) in enumerate(entries):
        x1, y1, x2, y2 = geom.bounds
        max_lat = min(90, max(abs(y1), abs(y2)) + pad_lat)
        pad_lon = pad_lat / max(1e-6, math.cos(math.radians(max_lat)))
        for j in sorted(tree.query(box(x1 - pad_lon, y1 - pad_lat, x2 + pad_lon, y2 + pad_lat))):
            if j <= i:
                continue
            yield ri, entries[j][0], max_distance_m


def merge_by_topology(cs):
    """Join compatible ways sharing snapped endpoints."""
    endpoint_to_ways = defaultdict(list)
    for wid in sorted(cs.ways):
        coords = cs.ways[wid]['coords']
        for endpoint in sorted({snap_coord(coords[0]), snap_coord(coords[-1])}):
            endpoint_to_ways[endpoint].append(wid)
    cs.set_components({wid: [wid] for wid in cs.ways})
    pairs = ((a, b, None) for wids in endpoint_to_ways.values() for a, b in combinations(wids, 2))
    return _merge_components(cs, pairs)


def merge_by_identity(cs):
    """Join matching names within 100 m, refs within 1 km, or Wikidata within 10 km."""
    key_to_comps = defaultdict(list)
    for rid, way_ids in cs.components.items():
        keys = {key for wid in way_ids for key in identity_tags(cs.ways[wid]['tags'])}
        for key in sorted(keys):
            key_to_comps[key].append(rid)

    def pairs():
        for tag, value in sorted(key_to_comps, key=lambda key: (key[0] != 'wikidata', key)):
            if tag == 'wikidata':
                distance = 10000
            elif tag == 'name' or tag.startswith('name:'):
                distance = 100
            else:
                distance = 1000
            yield from _nearby_candidates(cs, key_to_comps[tag, value], distance)

    return _merge_components(cs, pairs())


def cluster_anonymous(cs, max_distance_km=0.2):
    """Group unidentified non-rail fragments by actual line distance."""
    groups = defaultdict(list)
    for rid in cs.components:
        if cs.is_anonymous(rid) and cs.broad_type(rid) != 'rail':
            groups[cs.transport_type(rid), cs.project_status(rid)].append(rid)
    pairs = (pair for rids in groups.values()
             for pair in _nearby_candidates(cs, rids, max_distance_km * 1000))
    return _merge_components(cs, pairs)


def merge_parallel_tracks(cs, max_distance_m=10, max_bearing_diff=15):
    """Group unidentified rail tracks only when close, aligned, and compatible."""
    groups = defaultdict(list)
    for rid in cs.components:
        if cs.is_anonymous(rid) and cs.broad_type(rid) == 'rail':
            groups[cs.transport_type(rid), cs.project_status(rid)].append(rid)
    pairs = ((ri, rj, limit) for rids in groups.values()
             for ri, rj, limit in _nearby_candidates(cs, rids, max_distance_m)
             if bearing_diff(cs.bearing(ri), cs.bearing(rj)) <= max_bearing_diff)
    return _merge_components(cs, pairs)


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
    """Build a relation feature, retaining its shape until output."""
    member_geoms, member_tags, member_ids = [], [], []
    
    for wid in rel['member_way_ids']:
        if wid in ways:
            member_geoms.append(LineString(ways[wid]['coords']))
            member_tags.append(ways[wid]['tags'])
            member_ids.append(wid)
    
    if not member_geoms:
        return None
    
    try:
        merged = linemerge(MultiLineString(member_geoms))
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

    props['project_status'] = aggregate_project_status(get_linear_project_status(t) for t in member_tags)
    props['transport_type'] = transport
    props['display_name'] = create_display_name(props)
    
    ts = get_latest_timestamp(member_ids, ways)
    if ts:
        props['osm_last_modified'] = ts
    
    clean_props(props)
    
    return {
        'type': 'Feature',
        'id': f'relation/{rel_id}',
        'geometry': merged,
        'properties': props,
    }


def make_orphan_features(orphan_ways):
    """Build orphan features with Shapely shapes using all merge strategies."""
    cs = ComponentSet(orphan_ways)

    b, a = merge_by_topology(cs)
    LOGGER.debug(f"  merge_by_topology:    {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = merge_by_identity(cs)
    LOGGER.debug(f"  merge_by_identity:    {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = merge_parallel_tracks(cs)
    LOGGER.debug(f"  merge_parallel_tracks: {b:,} → {a:,} components ({b - a:,} merged)")
    b, a = cluster_anonymous(cs, max_distance_km=0.2)
    LOGGER.debug(f"  cluster_anonymous:    {b:,} → {a:,} components ({b - a:,} merged)")

    features = []
    for rep_id, way_ids in cs.components.items():
        ways_data = [orphan_ways[wid] for wid in way_ids]
        tags_list = [w['tags'] for w in ways_data]
        
        merged = cs.geometry(rep_id)
        
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
            'geometry': merged,
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
        return linemerge(MultiLineString(lines))
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
        get_linear_project_status(ways[wid]['tags']) for wid in member_way_ids if wid in ways)


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
    LOGGER.debug(f"  prune_overlapping_relations: {before_prune:,} → {len(relations):,} relations")
    relations = assign_unique_relation_members(relations, ways)
    LOGGER.debug(f"  assign_unique_relation_members: {len(relations):,} relations with owned ways")
    before_coincident = len(relations)
    relations = merge_coincident_relations(relations, ways)
    LOGGER.debug(f"  merge_coincident_relations: {before_coincident:,} → {len(relations):,} relations "
          f"({before_coincident - len(relations):,} directional pairs merged)")

    features = []
    processed_ways = set()

    for rel_id, rel in relations.items():
        feat = make_relation_feature(rel_id, rel, ways)
        if feat:
            processed_ways.update(wid for wid in rel['member_way_ids'] if wid in ways)
            features.append(feat)
    LOGGER.debug(f"  relation features built: {len(features):,}")

    orphans = {wid: way for wid, way in ways.items() if wid not in processed_ways}
    features.extend(make_orphan_features(orphans))

    return features


def main():
    args = _parse_args()
    WAYS_FILE = args.ways_file
    SOURCE_FILE = args.source_file
    OUTPUT_FILE = args.output

    with timed_step(LOGGER, 'read_ways', input=str(WAYS_FILE)):
        way_handler = WayGeometryHandler()
        way_handler.apply_file(WAYS_FILE, locations=True)
    LOGGER.info("Read ways", extra={'fields': {
        'event': 'geometry_read', 'renderable_ways': len(way_handler.ways),
        'unrenderable_ways': len(way_handler.unrenderable_way_ids),
    }})

    if not way_handler.ways:
        raise RuntimeError("No ways found")

    with timed_step(LOGGER, 'read_relations', input=str(SOURCE_FILE)):
        rel_handler = RelationHandler(way_handler.ways, way_handler.unrenderable_way_ids)
        # Only relations with a renderable candidate way can reach the output.
        # Filter native members before creating Python tags and member objects.
        tracker = None
        filters = []
        # IdTracker stores unsigned IDs. Preserve the original scan for temporary
        # negative OSM IDs rather than rejecting or silently omitting them.
        if all(wid >= 0 for wid in way_handler.ways):
            tracker = osmium.IdTracker()
            for wid in way_handler.ways:
                tracker.add_way(wid)
            filters.append(tracker.contains_filter())
        rel_handler.apply_file(SOURCE_FILE, filters=filters)
        del filters, tracker
        relations = rel_handler.relations
        relation_count = len(relations)
        del rel_handler
        way_handler.unrenderable_way_ids.clear()
    LOGGER.info("Read relations", extra={"fields": {"event": "relations_read", "relations": relation_count}})

    with timed_step(LOGGER, 'build'):
        features = build_features(way_handler.ways, relations)

    in_rel = sum(1 for f in features if f['id'].startswith('relation/'))
    orphan = sum(1 for f in features if f['id'].startswith('way/'))

    # Transport type breakdown
    type_counts = defaultdict(int)
    for f in features:
        type_counts[f['properties'].get('transport_type', 'unknown')] += 1
    for t_type, n in sorted(type_counts.items(), key=lambda x: -x[1]):
        LOGGER.info("Feature category", extra={'fields': {
            'event': 'feature_category', 'transport_type': t_type, 'features': n,
        }})

    with timed_step(LOGGER, 'write', output=str(OUTPUT_FILE)):
        # Convert one shape at a time instead of retaining every feature's
        # Python coordinate lists alongside the source coordinates and caches.
        encoded = ({**feature, 'geometry': mapping(feature['geometry'])}
                   for feature in features)
        write_feature_collection(encoded, OUTPUT_FILE)

    LOGGER.info("Wrote GeoJSON", extra={'fields': {
        'event': 'features_written', 'output': str(OUTPUT_FILE),
        'features': len(features), 'relation_features': in_rel, 'orphan_features': orphan,
    }})


if __name__ == '__main__':
    try:
        with timed_step(LOGGER, 'total', traceback=True):
            main()
    except Exception:
        raise SystemExit(1)
