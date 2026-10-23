import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree

from shapely.geometry import Polygon

import extract_areal_buildings as areal
from extract_areal_buildings import ArealExtractionHandler
from osm_io import write_feature_collection
from osm_policy import classify_areal_feature


class LifecycleLanduseTest(unittest.TestCase):
    def extract(self, tags, size=0.001):
        handler = ArealExtractionHandler()
        kind = classify_areal_feature(tags)
        if kind is not None:
            geom = Polygon([(2, 48), (2 + size, 48), (2 + size, 48 + size), (2, 48 + size)])
            handler.emit_feature(tags, kind, geom, 'way/123', '2026-10-19T00:00:00Z')
        return handler.features

    def test_development_landuses_keep_their_stage_and_source_tags(self):
        for state, status in [('proposed', 'proposed'), ('planned', 'planned'),
                              ('construction', 'under_construction')]:
            for value in ('yes', 'construction', 'residential', 'commercial', 'retail',
                          'industrial', 'education', 'institutional', 'civic_admin', 'religious'):
                with self.subTest(state=state, value=value):
                    key = f'{state}:landuse'
                    features = self.extract({key: value})
                    self.assertEqual(1, len(features))
                    props = features[0]['properties']
                    self.assertEqual(status, props['project_status'])
                    self.assertEqual('building', props['transport_type'])
                    self.assertEqual(value, props[key])

    def test_recreation_landuses_and_leisure_use_park_category(self):
        for state, status in [('proposed', 'proposed'), ('planned', 'planned'),
                              ('construction', 'under_construction')]:
            for key, value in [('landuse', 'recreation_ground'), ('landuse', 'village_green'),
                               ('landuse', 'park'), ('leisure', 'park'), ('leisure', 'sports_centre')]:
                with self.subTest(state=state, key=key, value=value):
                    features = self.extract({f'{state}:{key}': value})
                    self.assertEqual(1, len(features))
                    self.assertEqual('park', features[0]['properties']['transport_type'])
                    self.assertEqual(status, features[0]['properties']['project_status'])

    def test_names_and_generic_flags_do_not_admit_unsupported_future_landuses(self):
        for state in ('proposed', 'planned', 'construction'):
            for value in ('grass', 'brownfield', 'greenfield', 'farmland', 'unknown_use'):
                for flags in ({}, {'planned': 'yes'}, {'proposed': 'yes'}, {'construction': 'yes'}):
                    with self.subTest(state=state, value=value, flags=flags):
                        tags = {f'{state}:landuse': value, 'name': 'Named site', **flags}
                        self.assertEqual([], self.extract(tags))

    def test_inactive_landuse_does_not_create_a_project(self):
        for state in ('proposed', 'planned', 'construction'):
            with self.subTest(state=state):
                self.assertEqual([], self.extract({f'{state}:landuse': 'no'}))

    def test_brownfield_current_use_does_not_block_residential_redevelopment(self):
        features = self.extract({'landuse': 'brownfield', 'planned:landuse': 'residential'})
        self.assertEqual('planned', features[0]['properties']['project_status'])
        self.assertEqual('residential', features[0]['properties']['building_category'])

    def test_unspecified_future_use_does_not_inherit_current_use(self):
        for current in ('commercial', 'retail', 'industrial', 'residential'):
            with self.subTest(current=current):
                features = self.extract({'landuse': current, 'planned:landuse': 'yes'})
                self.assertEqual(1, len(features))
                self.assertNotIn('building_category', features[0]['properties'])

    def test_generic_flags_do_not_make_current_park_the_future_use(self):
        for target in ('yes', 'education'):
            with self.subTest(target=target):
                features = self.extract({
                    'leisure': 'park', 'planned': 'yes', 'planned:landuse': target,
                })
                self.assertEqual('building', features[0]['properties']['transport_type'])
                self.assertEqual('planned', features[0]['properties']['project_status'])
        self.assertEqual([], self.extract({
            'leisure': 'park', 'planned': 'yes', 'planned:landuse': 'grass',
        }))

    def test_generic_developments_still_need_size_or_identity(self):
        tags = {'planned:landuse': 'yes', 'landuse': 'retail'}
        self.assertEqual([], self.extract(tags, size=0.0001))
        self.assertEqual(1, len(self.extract({**tags, 'name': 'Future development'}, size=0.0001)))
        self.assertEqual(1, len(self.extract({'planned:landuse': 'education'}, size=0.0001)))

    def test_other_supported_projects_can_qualify_alongside_landscaping(self):
        features = self.extract({'planned:building': 'apartments', 'planned:landuse': 'grass'})
        self.assertEqual('residential', features[0]['properties']['building_category'])
        self.assertEqual('planned', features[0]['properties']['project_status'])

    def test_unsupported_landuse_does_not_supply_another_projects_stage(self):
        for key in ('construction:landuse', 'proposed:landuse'):
            with self.subTest(key=key):
                features = self.extract({key: 'grass', 'planned:landuse': 'education'})
                self.assertEqual('planned', features[0]['properties']['project_status'])

    def test_existing_scope_exclusions_still_apply(self):
        for extra in ({'planned:building': 'house'}, {'planned:power': 'plant'},
                      {'boundary': 'administrative'}, {'highway': 'cycleway'}):
            with self.subTest(extra=extra):
                self.assertEqual([], self.extract({'planned:landuse': 'yes', **extra}))

    def test_way_and_multipolygon_are_extracted_from_osm(self):
        for is_relation in (False, True):
            with self.subTest(is_relation=is_relation):
                root = ElementTree.Element('osm', version='0.6')
                for node_id, (lon, lat) in enumerate([(2, 48), (2.001, 48),
                                                      (2.001, 48.001), (2, 48.001)], start=1):
                    ElementTree.SubElement(root, 'node', id=str(node_id), lon=str(lon), lat=str(lat))
                way = ElementTree.SubElement(root, 'way', id='123')
                for node_id in (1, 2, 3, 4, 1):
                    ElementTree.SubElement(way, 'nd', ref=str(node_id))
                target = way
                if is_relation:
                    target = ElementTree.SubElement(root, 'relation', id='456')
                    ElementTree.SubElement(target, 'member', type='way', ref='123', role='outer')
                    ElementTree.SubElement(target, 'tag', k='type', v='multipolygon')
                ElementTree.SubElement(target, 'tag', k='planned:landuse', v='yes')
                with tempfile.TemporaryDirectory() as directory:
                    source = Path(directory) / 'project.osm'
                    ElementTree.ElementTree(root).write(source, encoding='utf-8')
                    handler = ArealExtractionHandler()
                    handler.apply_file(str(source), locations=True)
                self.assertEqual(1, len(handler.features))
                feature = handler.features[0]
                self.assertEqual('relation/456' if is_relation else 'way/123', feature['id'])
                self.assertEqual('planned', feature['properties']['project_status'])


class AreaOutputTest(unittest.TestCase):
    def test_main_keeps_unnamed_enclosing_area_and_inner_building(self):
        shapes = [
            Polygon([(2, 48), (2.01, 48), (2.01, 48.01), (2, 48.01)]),
            Polygon([(2.001, 48.001), (2.002, 48.001),
                     (2.002, 48.002), (2.001, 48.002)]),
        ]

        def read_features(handler, *args, **kwargs):
            for i, geom in enumerate(shapes):
                handler.emit_feature(
                    {'planned:building': 'apartments'},
                    'building', geom, f'way/{i + 1}', None,
                )

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'areas.geojson'
            args = Namespace(source='unused.osm.pbf', output=str(output))
            with patch.object(areal, '_parse_args', return_value=args), \
                    patch.object(ArealExtractionHandler, 'apply_file', read_features):
                areal.main()

            features = json.loads(output.read_text())['features']
            self.assertEqual(['way/1', 'way/2'], [f['id'] for f in features])
            for feature, geom in zip(features, shapes):
                self.assertEqual(json.loads(json.dumps(areal.mapping(geom))), feature['geometry'])

    def test_main_preserves_each_shape_when_feature_ids_repeat(self):
        shapes = [
            Polygon([(2, 48), (2.001, 48), (2.001, 48.001), (2, 48.001)]),
            Polygon([(3, 48), (3.002, 48), (3.002, 48.002), (3, 48.002)]),
        ]

        def read_features(handler, *args, **kwargs):
            for i, geom in enumerate(shapes):
                handler.emit_feature(
                    {'planned:building': 'apartments', 'name': f'Building {i}'},
                    'building', geom, 'way/123', '2026-10-19T00:00:00Z',
                )

        reference = ArealExtractionHandler()
        read_features(reference)
        with tempfile.TemporaryDirectory() as directory:
            expected = Path(directory) / 'expected.geojson'
            actual = Path(directory) / 'actual.geojson'
            write_feature_collection(reference.features, expected)
            args = Namespace(source='unused.osm.pbf', output=str(actual))
            with patch.object(areal, '_parse_args', return_value=args), \
                    patch.object(ArealExtractionHandler, 'apply_file', read_features):
                areal.main()

            self.assertEqual(expected.read_bytes(), actual.read_bytes())
            features = json.loads(actual.read_text())['features']
            self.assertEqual(['way/123', 'way/123'], [f['id'] for f in features])
            self.assertNotEqual(features[0]['geometry'], features[1]['geometry'])


if __name__ == '__main__':
    unittest.main()
