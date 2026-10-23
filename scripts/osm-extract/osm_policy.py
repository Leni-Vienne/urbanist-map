"""OSM project selection and tag interpretation for both Python extractors.

Start with is_transport_way() or classify_areal_feature() for eligibility, then
get_transport_type()/get_areal_building_category() and the corresponding status
function for interpretation. passes_areal_size_gate() takes a measured footprint;
is_linear_project_relation() takes member counts, including unrenderable candidates.

These rules use only tags and scalar measurements: importing this module needs
neither osmium nor Shapely. PBF I/O, geometry construction, containment filtering,
and project grouping live in the extractors. Shell candidate filters and
TypeScript application-tag derivation remain separate stages.
"""

# Linear transport policy

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

# All valid transport values for filtering ways
TRANSPORT_VALUES = set(_VALUE_TO_TYPE.keys())

_LIFECYCLE_STATUSES = ('proposed', 'construction', 'planned')
_PRIMARY_TRANSPORT_KEYS = ('railway', 'highway', 'waterway', 'aerialway', 'aeroway')
_TRANSPORT_KEY_FALLBACKS = (
    ('aerialway', 'cable_car'), ('railway', 'rail'), ('highway', 'road'),
    ('waterway', 'waterway'), ('aeroway', 'airport'),
)
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
    for stage in ('construction', 'proposed', 'planned'):
        for key, fallback in _TRANSPORT_KEY_FALLBACKS:
            val = tags.get(f'{stage}:{key}', '')
            if val:
                return _VALUE_TO_TYPE.get(val, fallback)

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
    for key, fallback in _TRANSPORT_KEY_FALLBACKS:
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


def get_linear_project_status(tags):
    """Linear lifecycle: construction, then planned, then proposed.

    Areal lifecycle has its own precedence in get_areal_project_status().
    """
    status_keys = (*_PRIMARY_TRANSPORT_KEYS, *_CYCLEWAY_KEYS, 'state')
    if any(tags.get(k) == 'construction' for k in status_keys):
        return 'under_construction'
    if tags.get('construction', '') not in ('', 'no'):
        return 'under_construction'
    if any(tags.get(f'construction:{k}') for k in _PRIMARY_TRANSPORT_KEYS):
        return 'under_construction'
    if (tags.get('railway') in _URBAN_RAIL_VALUES and
            any(tags.get(k) for k in _URBAN_RAIL_CONSTRUCTION_KEYS)):
        return 'under_construction'
    if any(tags.get(k) == 'planned' for k in status_keys):
        return 'planned'
    if tags.get('planned', '') not in ('', 'no'):
        return 'planned'
    if any(tags.get(f'planned:{k}') for k in _PRIMARY_TRANSPORT_KEYS):
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


def is_linear_project_relation(tags, candidate_member_count, member_way_count):
    """Whether a relation may group project ways; usable geometry is checked separately.

    Candidate counts include ways without usable geometry, so missing nodes do not
    change the route's eligibility. At least one renderable member must still be
    present for the extractor to emit the relation.
    """
    past_values = ('historic', 'abandoned', 'razed', 'dismantled', 'disused', 'removed')
    if any(tags.get(key, '') in past_values for key in _PRIMARY_TRANSPORT_KEYS):
        return False
    if tags.get('historic') or tags.get('abandoned'):
        return False
    if tags.get('type') == 'multipolygon':
        return False
    if tags.get('type') != 'route' or has_relation_lifecycle(tags):
        return True

    # Service routes over existing roads need an explicit project lifecycle.
    if tags.get('route', '') in ('bus', 'coach', 'trolleybus', 'share_taxi'):
        return False
    if not member_way_count:
        return False

    # Track routes require 75% candidate members; other routes require 50%.
    threshold = 0.75 if tags.get('route', '') == 'tracks' else 0.50
    return candidate_member_count / member_way_count >= threshold


# Areal development policy

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
    'industrial': 'industrial',
    'warehouse': 'industrial',
}

# Future uses in scope for urban development. 'yes' identifies a project without
# specifying its use; it must still pass the generic size/identity checks.
DEVELOPMENT_LANDUSES = frozenset({
    'construction', 'yes', 'residential', 'commercial', 'retail', 'industrial',
    'education', 'institutional', 'civic_admin', 'religious',
})
TYPED_DEVELOPMENT_LANDUSES = DEVELOPMENT_LANDUSES - {'yes', 'construction'}
PARK_TYPES = frozenset({
    'park', 'garden', 'playground', 'recreation_ground', 'stadium', 'pitch',
    'golf_course', 'sports_centre',
})
RECREATION_LANDUSES = PARK_TYPES | {'village_green'}
PROJECT_LANDUSES = DEVELOPMENT_LANDUSES | RECREATION_LANDUSES
LIFECYCLE_STATES = ('construction', 'proposed', 'planned')

# Utility/industrial infrastructure out of scope regardless of areal context
# (power plants, solar farms, telecom, man-made structures like pipelines).
# UTILITY_KEYS catch key-based tagging (man_made=pipeline); UTILITY_VALUES catch
# the same infrastructure tagged as a lifecycle value (proposed=pipeline).
UTILITY_KEYS = ('power', 'telecom', 'man_made')
UTILITY_VALUES = frozenset({
    'pipeline', 'line', 'minor_line', 'cable',
    'power', 'power_plant', 'generator', 'substation', 'solar_plant', 'wind_farm',
})

# Transport infrastructure keys; polygons carrying them (railway yard, road junction
# area, etc.) are excluded unless the primary identity is a construction-site area.
TRANSPORT_KEYS = ('highway', 'railway', 'waterway', 'public_transport', 'aerialway', 'aeroway')

# Highway values that are always linear; excluded even with areal context
# (e.g. a bridge deck mapped as building=construction + highway=cycleway).
# Area-capable values (pedestrian, platform, rest_area, services, footway, path)
# are kept so pedestrian plazas and transit platforms under construction survive.
LINEAR_HIGHWAY_VALUES = frozenset({
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'residential', 'unclassified',
    'service', 'living_street', 'road', 'bus_guideway', 'busway', 'cycleway',
})

# Transport infrastructure types as construction=/proposed=/planned= values.
INFRASTRUCTURE_VALUES = frozenset({
    'tram', 'rail', 'railway', 'light_rail', 'subway', 'metro', 'narrow_gauge', 'train',
    'monorail', 'funicular', 'miniature',
    'highway', 'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential',
    'service', 'living_street', 'road', 'bridge', 'tunnel', 'minor',
    'cycleway', 'cyclepath', 'footway', 'pedestrian', 'path', 'track', 'steps', 'bridleway',
    'corridor', 'sidewalk',
    'aerialway', 'cable_car', 'gondola', 'chair_lift', 'zip_line',
    'aeroway', 'runway', 'taxiway', 'airstrip',
    'canal', 'river', 'stream', 'ditch', 'drain', 'waterway',
})

LIFECYCLE_PREFIXES = ('', 'construction:', 'proposed:', 'planned:')

IDENTITY_KEYS = ('name', 'wikidata', 'description', 'website')


def has_identity(tags):
    """True when a mapper identified the feature (name, wikidata, description, website)."""
    return any(tags.get(k, '').strip() for k in IDENTITY_KEYS)


def derive_building_category(values):
    """First recognised type among the given tag values wins; None if untyped."""
    for v in values:
        cat = CATEGORY_BY_VALUE.get(v)
        if cat:
            return cat
    return None


def has_namespaced_area_target(tags):
    """Future area targets describe the project rather than the current site."""
    return any(
        tags.get(f'{state}:{key}', '') not in ('', 'no')
        for state in LIFECYCLE_STATES
        for key in ('building', 'landuse', 'leisure')
    )


def has_namespaced_area_project(tags, state):
    """Only recognized future area features supply a project stage."""
    return (
        tags.get(f'{state}:building', '') not in ('', 'no') or
        tags.get(f'{state}:landuse', '') in PROJECT_LANDUSES or
        tags.get(f'{state}:leisure', '') in PARK_TYPES
    )


def classify_areal_feature(tags):
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
    landuse_targets = (construction_landuse, proposed_landuse, planned_landuse)
    has_landuse_target = any(value not in ('', 'no') for value in landuse_targets)

    if 'administrative' in (
        tags.get('boundary'), construction, proposed, planned,
        tags.get('construction:boundary'), tags.get('proposed:boundary'),
        tags.get('planned:boundary'),
    ):
        return None

    # Exclude small residential building types regardless of area. The target use is read
    # from the most specific lifecycle key first, falling back to the current building type;
    # yes/no values carry no type information and are skipped.
    for key in ('construction', 'construction:building', 'proposed', 'planned',
                'proposed:building', 'planned:building', 'building:use', 'building'):
        value = tags.get(key, '')
        if value and value not in ('yes', 'no'):
            if value in EXCLUDE_BUILDINGS:
                return None
            break

    # When the primary identity is a construction site (landuse=construction, building tag,
    # lifecycle building/landuse keys) the feature is an area, not transport infrastructure;
    # the transport exclusions below are relaxed in that context so construction:railway/highway
    # etc. don't wrongly exclude a subway station or road tunnel construction site.
    has_areal_context = (landuse == 'construction' or building != '' or
                         leisure in ('construction', 'proposed', 'planned') or
                         amenity in ('construction', 'proposed', 'planned') or
                         proposed_building != '' or planned_building != '' or construction_building != '' or
                         proposed_landuse != '' or planned_landuse != '' or construction_landuse != '' or
                         any(tags.get(f'{state}:leisure', '') in PARK_TYPES for state in LIFECYCLE_STATES))

    # Utility/industrial infrastructure is out of scope regardless of areal context,
    # whether tagged by key (man_made=pipeline) or as a lifecycle value (proposed=pipeline).
    if any(f'{prefix}{k}' in tags for k in UTILITY_KEYS for prefix in LIFECYCLE_PREFIXES):
        return None
    if any(v in UTILITY_VALUES for v in (construction, proposed, planned)):
        return None

    # Transport infrastructure mapped as polygons (railway yard, road junction area, etc.)
    # is excluded unless the primary identity is a construction-site area: a subway station
    # or road tunnel under construction with landuse=construction + construction:railway
    # is a valid areal project, not a transport-infrastructure polygon.
    if not has_areal_context and any(f'{prefix}{k}' in tags
                                     for k in TRANSPORT_KEYS
                                     for prefix in LIFECYCLE_PREFIXES):
        return None

    # Always-linear highway values are excluded even with areal context
    # (e.g. a bridge deck mapped as building=construction + highway=cycleway).
    if has_areal_context and tags.get('highway', '') in LINEAR_HIGHWAY_VALUES:
        return None

    # Exclude features whose construction/proposed/planned value is a transport infrastructure
    # type. With landuse=construction or a building tag, the value names the future land use
    # (e.g. construction=residential -> landuse=residential), not a road class, so keep it.
    if not has_areal_context and any(v in INFRASTRUCTURE_VALUES for v in (construction, proposed, planned)):
        return None

    if (
        leisure in PARK_TYPES and
        not has_namespaced_area_target(tags) and
        (construction or proposed or planned)
    ) or any(v in PARK_TYPES for v in (construction, proposed, planned)) or any(
        value in RECREATION_LANDUSES for value in landuse_targets
    ) or any(tags.get(f'{state}:leisure', '') in PARK_TYPES for state in LIFECYCLE_STATES):
        return 'park'

    # Explicit building/site signals can qualify independently of a landuse tag.
    # Generic lifecycle flags must not bypass an unsupported future landuse such
    # as planned:landuse=grass + planned=yes.
    is_building_construction = (
        building in ('construction', 'proposed', 'planned') or
        landuse == 'construction' or
        leisure in ('construction', 'proposed', 'planned') or
        amenity in ('construction', 'proposed', 'planned') or
        any(v in NONHOUSE_TYPES for v in (construction, proposed, planned)) or
        (proposed_building and proposed_building != 'no') or
        (planned_building and planned_building != 'no') or
        (construction_building and construction_building != 'no') or
        any(value in DEVELOPMENT_LANDUSES for value in landuse_targets)
    )
    # Preserve the open-ended proposed=/planned= fallback when no future landuse
    # was specified. Existing domain/type exclusions above still apply.
    generic_project = not has_landuse_target and (
        construction == 'yes' or
        proposed not in ('', 'no') or
        planned not in ('', 'no')
    )
    return 'building' if is_building_construction or generic_project else None


def _area_landuse_targets(tags):
    return tuple(tags.get(f'{state}:landuse', '') for state in LIFECYCLE_STATES)


def _future_area_values(tags):
    # Preserve the existing precedence: generic lifecycle values, then future
    # buildings, then future landuses. Current site values are considered last.
    return [tags.get(key, '') for key in (
        'construction', 'proposed', 'planned',
        'proposed:building', 'planned:building', 'construction:building',
        'proposed:landuse', 'planned:landuse', 'construction:landuse',
    )]


def get_areal_building_category(tags):
    """Future use wins; an unspecified future target never inherits current use."""
    values = _future_area_values(tags)
    if not has_namespaced_area_target(tags):
        values += [tags.get('building', ''), tags.get('landuse', '')]
    return derive_building_category(values)


def passes_areal_size_gate(tags, kind, category, area_m2):
    """Keep parks, typed/identified developments, or at least 400 m² of floor area.

    Call after classify_areal_feature(): identity and size never override its
    type exclusions. area_m2 is the measured footprint, before rounding.
    """
    has_nonhouse_signal = (
        any(value in NONHOUSE_TYPES for value in _future_area_values(tags)) or
        any(value in TYPED_DEVELOPMENT_LANDUSES for value in _area_landuse_targets(tags)) or
        (not has_namespaced_area_target(tags) and (
            tags.get('building', '') in NONHOUSE_TYPES or
            tags.get('landuse', '') in ('commercial', 'retail', 'industrial', 'residential')
        ))
    )
    if kind != 'building' or category is not None or has_nonhouse_signal or has_identity(tags):
        return True
    try:
        levels = max(float(tags.get('building:levels', '')), 1.0)
    except ValueError:
        levels = 1.0
    if area_m2 * levels < 400:
        return False
    return True


def get_areal_project_status(tags):
    """Areal lifecycle: construction, then proposed, then planned; default construction.

    This intentionally preserves the areal extractor's existing precedence,
    including how generic construction=yes differs from a typed construction=.
    """
    construction = tags.get('construction', '')
    proposed = tags.get('proposed', '')
    planned = tags.get('planned', '')
    building = tags.get('building', '')
    landuse = tags.get('landuse', '')
    leisure = tags.get('leisure', '')
    amenity = tags.get('amenity', '')
    if construction and construction not in ('yes', 'no'):
        return 'under_construction'
    if (building == 'construction' or landuse == 'construction' or
            'construction' in (leisure, amenity) or has_namespaced_area_project(tags, 'construction')):
        return 'under_construction'
    if (building == 'proposed' or 'proposed' in (leisure, amenity) or
            (proposed and proposed != 'no') or has_namespaced_area_project(tags, 'proposed')):
        return 'proposed'
    if (building == 'planned' or 'planned' in (leisure, amenity) or
            (planned and planned != 'no') or has_namespaced_area_project(tags, 'planned')):
        return 'planned'
    return 'under_construction'
