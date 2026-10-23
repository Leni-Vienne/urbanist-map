import unittest

from osm_policy import (
    aggregate_project_status,
    classify_areal_feature,
    get_areal_building_category,
    get_areal_project_status,
    get_linear_project_status,
    get_transport_type,
    is_linear_project_relation,
    is_transport_way,
    passes_areal_size_gate,
)


class LinearPolicyTest(unittest.TestCase):
    def test_lifecycle_tagging_schemes_describe_the_same_transport(self):
        for stage, status in [('construction', 'under_construction'),
                              ('planned', 'planned'), ('proposed', 'proposed')]:
            for tags in (
                {'railway': stage, stage: 'subway'},
                {f'{stage}:railway': 'subway'},
                {'highway': stage, stage: 'cycleway'},
            ):
                with self.subTest(tags=tags):
                    self.assertTrue(is_transport_way(tags))
                    self.assertEqual('bike' if 'highway' in tags else 'subway',
                                     get_transport_type(tags))
                    self.assertEqual(status, get_linear_project_status(tags))

    def test_future_cycle_lane_takes_priority_over_existing_road(self):
        tags = {'highway': 'tertiary', 'cycleway:right': 'planned'}
        self.assertTrue(is_transport_way(tags))
        self.assertEqual('bike', get_transport_type(tags))
        self.assertEqual('planned', get_linear_project_status(tags))

    def test_station_construction_site_belongs_to_areal_extraction(self):
        tags = {'landuse': 'construction', 'construction:railway': 'subway'}
        self.assertFalse(is_transport_way(tags))
        self.assertEqual('building', classify_areal_feature(tags))

    def test_urban_rail_fitout_qualifies_but_mainline_electrification_does_not(self):
        tags = {'railway': 'subway', 'construction:electrified': 'contact_line'}
        self.assertTrue(is_transport_way(tags))
        self.assertEqual('under_construction', get_linear_project_status(tags))
        self.assertFalse(is_transport_way({**tags, 'railway': 'rail'}))


class RelationPolicyTest(unittest.TestCase):
    def test_tracks_need_three_quarters_candidate_members_other_routes_need_half(self):
        self.assertFalse(is_linear_project_relation({'type': 'route', 'route': 'tracks'}, 2, 4))
        self.assertTrue(is_linear_project_relation({'type': 'route', 'route': 'tracks'}, 3, 4))
        self.assertFalse(is_linear_project_relation({'type': 'route', 'route': 'tram'}, 1, 4))
        self.assertTrue(is_linear_project_relation({'type': 'route', 'route': 'tram'}, 2, 4))
        self.assertFalse(is_linear_project_relation({'type': 'route', 'route': 'tram'}, 0, 0))

    def test_bus_route_needs_explicit_lifecycle_even_when_all_members_qualify(self):
        tags = {'type': 'route', 'route': 'bus'}
        self.assertFalse(is_linear_project_relation(tags, 4, 4))
        self.assertTrue(is_linear_project_relation({**tags, 'state': 'planned'}, 1, 4))

    def test_past_infrastructure_and_multipolygons_override_lifecycle(self):
        tags = {'type': 'route', 'state': 'proposed'}
        for extra in ({'railway': 'abandoned'}, {'historic': 'yes'}, {'type': 'multipolygon'}):
            with self.subTest(extra=extra):
                self.assertFalse(is_linear_project_relation({**tags, **extra}, 4, 4))


class LifecyclePolicyTest(unittest.TestCase):
    def test_existing_linear_and_areal_precedence_remains_distinct(self):
        tags = {'planned': 'yes', 'proposed': 'yes'}
        self.assertEqual('planned', get_linear_project_status(tags))
        self.assertEqual('proposed', get_areal_project_status(tags))
        self.assertEqual('under_construction',
                         get_linear_project_status({**tags, 'construction': 'yes'}))
        self.assertEqual('proposed', get_areal_project_status({**tags, 'construction': 'yes'}))
        self.assertEqual('under_construction',
                         get_areal_project_status({**tags, 'construction': 'apartments'}))

    def test_group_status_uses_majority_and_less_certain_status_for_ties(self):
        self.assertEqual('planned', aggregate_project_status(['planned', 'under_construction']))
        self.assertEqual('proposed', aggregate_project_status(['planned', 'proposed']))
        self.assertEqual('under_construction',
                         aggregate_project_status(['under_construction', 'planned', 'under_construction']))


class ArealSelectionTest(unittest.TestCase):
    def test_proposed_administrative_boundary_is_not_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'proposed',
            'proposed': 'administrative',
            'name': 'West Hertfordshire',
        }

        self.assertIsNone(classify_areal_feature(tags))

    def test_active_administrative_boundary_with_lifecycle_tag_is_not_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'administrative',
            'proposed': 'yes',
            'name': 'Future District',
        }

        self.assertIsNone(classify_areal_feature(tags))

    def test_administrative_lifecycle_values_are_not_projects(self):
        for lifecycle in ('construction', 'proposed', 'planned'):
            with self.subTest(lifecycle=lifecycle):
                tags = {
                    'type': 'boundary',
                    'boundary': lifecycle,
                    lifecycle: 'administrative',
                    'name': 'Future District',
                }

                self.assertIsNone(classify_areal_feature(tags))

    def test_administrative_lifecycle_boundary_keys_are_not_projects(self):
        for lifecycle in ('construction', 'proposed', 'planned'):
            with self.subTest(lifecycle=lifecycle):
                tags = {
                    'type': 'boundary',
                    'boundary': lifecycle,
                    lifecycle: 'yes',
                    f'{lifecycle}:boundary': 'administrative',
                    'name': 'Future District',
                }

                self.assertIsNone(classify_areal_feature(tags))

    def test_proposed_park_boundary_remains_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'protected_area',
            'proposed': 'park',
            'name': 'Future Park',
        }

        self.assertEqual('park', classify_areal_feature(tags))

    def test_unknown_planned_type_remains_a_building_candidate(self):
        tags = {
            'planned': 'cultural_centre',
            'name': 'Future Cultural Centre',
        }

        self.assertEqual('building', classify_areal_feature(tags))


class ArealUseAndSizeTest(unittest.TestCase):
    def test_future_use_replaces_current_use_instead_of_inheriting_it(self):
        tags = {'landuse': 'retail', 'planned:landuse': 'residential'}
        self.assertEqual('residential', get_areal_building_category(tags))
        tags['planned:landuse'] = 'yes'
        self.assertIsNone(get_areal_building_category(tags))
        self.assertFalse(passes_areal_size_gate(tags, 'building', None, 100))

    def test_generic_development_threshold_uses_floor_area_and_includes_400(self):
        tags = {'building': 'construction', 'building:levels': '2'}
        self.assertFalse(passes_areal_size_gate(tags, 'building', None, 199))
        self.assertTrue(passes_areal_size_gate(tags, 'building', None, 200))
        for levels in ('', 'unknown', '0', '-2'):
            with self.subTest(levels=levels):
                tags['building:levels'] = levels
                self.assertFalse(passes_areal_size_gate(tags, 'building', None, 399))
                self.assertTrue(passes_areal_size_gate(tags, 'building', None, 400))

    def test_parks_typed_developments_and_identified_sites_are_exempt_from_size_gate(self):
        for tags in ({'planned:leisure': 'park'}, {'planned:building': 'apartments'},
                     {'planned:landuse': 'education'}, {'building': 'construction', 'name': 'Site'}):
            with self.subTest(tags=tags):
                kind = classify_areal_feature(tags)
                self.assertIsNotNone(kind)
                self.assertTrue(passes_areal_size_gate(tags, kind, get_areal_building_category(tags), 10))


if __name__ == '__main__':
    unittest.main()
