from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import extract_linear_topo as linear

from extract_linear_topo import ComponentSet, RelationHandler, WayGeometryHandler, build_features


class RelationHandlerTest(unittest.TestCase):
    def test_osm_geometry_and_relation_output_use_the_shared_policy(self):
        source_xml = '''<osm version="0.6">
          <node id="1" lon="2" lat="48"/>
          <node id="2" lon="2.001" lat="48"/>
          <node id="3" lon="2.002" lat="48"/>
          <node id="4" lon="2.003" lat="48"/>
          <way id="101">
            <nd ref="1"/><nd ref="2"/>
            <tag k="railway" v="proposed"/><tag k="proposed" v="subway"/>
          </way>
          <way id="102">
            <nd ref="2"/><nd ref="3"/>
            <tag k="proposed:railway" v="subway"/>
          </way>
          <way id="103">
            <nd ref="3"/><nd ref="4"/><tag k="railway" v="subway"/>
          </way>
          <relation id="501">
            <member type="way" ref="101" role=""/>
            <member type="way" ref="102" role=""/>
            <member type="way" ref="103" role=""/>
            <tag k="type" v="route"/><tag k="route" v="tracks"/>
            <tag k="state" v="proposed"/><tag k="name" v="Metro extension"/>
          </relation>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'project.osm'
            source.write_text(source_xml)
            way_handler = WayGeometryHandler()
            way_handler.apply_file(str(source), locations=True)
            relation_handler = RelationHandler(way_handler.ways)
            relation_handler.apply_file(str(source))

        with redirect_stdout(StringIO()):
            features = build_features(way_handler.ways, relation_handler.relations)

        self.assertEqual(1, len(features))
        feature = features[0]
        self.assertEqual('relation/501', feature['id'])
        self.assertEqual('subway', feature['properties']['transport_type'])
        self.assertEqual('proposed', feature['properties']['project_status'])
        self.assertEqual('Metro extension', feature['properties']['display_name'])
        self.assertEqual(['way/101', 'way/102'], feature['properties']['osm_ids'])
        self.assertEqual([[2, 48], [2.001, 48], [2.002, 48]],
                         [list(coord) for coord in linear.mapping(feature['geometry'])['coordinates']])

    def test_unrenderable_candidates_count_towards_route_eligibility_but_are_not_emitted(self):
        relation = SimpleNamespace(
            id=123,
            tags=[SimpleNamespace(k='type', v='route'), SimpleNamespace(k='route', v='tracks')],
            members=[SimpleNamespace(type='w', ref=wid) for wid in (1, 2, 3, 4)],
        )
        handler = RelationHandler({1: {}}, unrenderable_way_ids={2, 3})
        handler.relation(relation)

        self.assertEqual([1], handler.relations[123]['member_way_ids'])

        without_missing_geometry = RelationHandler({1: {}})
        without_missing_geometry.relation(relation)
        self.assertEqual({}, without_missing_geometry.relations)

    def test_explicit_lifecycle_still_requires_a_renderable_project_member(self):
        relation = SimpleNamespace(
            id=123,
            tags=[SimpleNamespace(k='type', v='route'), SimpleNamespace(k='state', v='planned')],
            members=[SimpleNamespace(type='w', ref=1)],
        )
        handler = RelationHandler({}, unrenderable_way_ids={1})
        handler.relation(relation)

        self.assertEqual({}, handler.relations)

    def test_multipolygon_relation_is_not_a_linear_project(self):
        relation = SimpleNamespace(
            id=14721596,
            tags=[
                SimpleNamespace(k="type", v="multipolygon"),
                SimpleNamespace(k="landuse", v="construction"),
            ],
            members=[SimpleNamespace(type="w", ref=1)],
        )
        handler = RelationHandler({1: {"coords": [(0, 0), (1, 1)], "tags": {}}})

        handler.relation(relation)

        self.assertEqual({}, handler.relations)


class DeferredGeometryOutputTest(unittest.TestCase):
    def setUp(self):
        self.ways = {
            1: {'coords': [(2, 48), (2.001, 48)],
                'tags': {'railway': 'proposed', 'proposed': 'subway'}, 'timestamp': None},
            2: {'coords': [(3, 49), (3.001, 49)],
                'tags': {'highway': 'construction', 'construction': 'primary'}, 'timestamp': None},
        }
        self.relations = {10: {'tags': {'type': 'route', 'name': 'Métro extension'},
                               'member_way_ids': [1]}}

    def test_build_keeps_shapes_for_both_relation_and_orphan_features(self):
        with patch.object(linear, 'mapping', side_effect=AssertionError('Eager coordinate conversion')):
            features = build_features(self.ways, self.relations)
        self.assertEqual(['relation/10', 'way/2'], [feature['id'] for feature in features])
        self.assertEqual([(2, 48), (2.001, 48)], list(features[0]['geometry'].coords))
        self.assertEqual([(3, 49), (3.001, 49)], list(features[1]['geometry'].coords))

    def test_cli_writes_relation_and_orphan_shapes_as_geojson(self):
        way_handler = SimpleNamespace(ways=self.ways, unrenderable_way_ids=set(),
                                      apply_file=lambda *args, **kwargs: None)
        relation_handler = SimpleNamespace(relations=self.relations,
                                           apply_file=lambda *args, **kwargs: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'linear.geojson'
            args = SimpleNamespace(ways_file='ways.pbf', source_file='relations.pbf', output=output)
            with patch.object(linear, '_parse_args', return_value=args), \
                 patch.object(linear, 'WayGeometryHandler', return_value=way_handler), \
                 patch.object(linear, 'RelationHandler', return_value=relation_handler):
                linear.main()
            features = json.loads(output.read_text())['features']
        self.assertEqual(['relation/10', 'way/2'], [feature['id'] for feature in features])
        self.assertEqual('Métro extension', features[0]['properties']['name'])
        self.assertEqual({'type': 'LineString', 'coordinates': [[2, 48], [2.001, 48]]},
                         features[0]['geometry'])
        self.assertEqual({'type': 'LineString', 'coordinates': [[3, 49], [3.001, 49]]},
                         features[1]['geometry'])


class ComponentGeometryCacheTest(unittest.TestCase):
    def test_membership_changes_invalidate_properties_without_discarding_unchanged_geometry(self):
        ways = {
            1: {'coords': [(0, 0), (1, 0)], 'tags': {'railway': 'construction', 'construction': 'rail'}},
            2: {'coords': [(1, 0), (2, 0)], 'tags': {'railway': 'construction', 'construction': 'rail'}},
            3: {'coords': [(5, 0), (6, 0)], 'tags': {'highway': 'planned', 'planned': 'primary'}},
        }
        components = ComponentSet(ways)
        components.set_components({1: [1], 2: [2], 3: [3]})
        components.geometry(1)
        unchanged = components.geometry(3)
        components.set_components({1: [1, 2], 3: [3]})
        self.assertEqual((0, 0, 2, 0), components.geometry(1).bounds)
        self.assertIs(unchanged, components.geometry(3))

        # Member order breaks classification ties, so an order change must
        # invalidate the cache even when the set of members is identical.
        components.set_components({1: [1, 3]})
        self.assertEqual('rail', components.transport_type(1))
        components.set_components({1: [3, 1]})
        self.assertEqual('road', components.transport_type(1))


class NativeRelationFilterTest(unittest.TestCase):
    SOURCE = '''<osm version="0.6">
      <node id="1" lon="2" lat="48"/><node id="2" lon="2.001" lat="48"/>
      <way id="101"><nd ref="1"/><nd ref="2"/>
        <tag k="railway" v="construction"/><tag k="construction" v="rail"/></way>
      <way id="102"><nd ref="999"/><tag k="railway" v="construction"/></way>
      <way id="103"><nd ref="2"/><tag k="railway" v="construction"/></way>
      <way id="104"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way>
      <relation id="501"><member type="way" ref="101" role=""/>
        <member type="way" ref="102" role=""/><member type="way" ref="103" role=""/>
        <member type="way" ref="104" role=""/><tag k="type" v="route"/>
        <tag k="route" v="tracks"/></relation>
      <relation id="502"><member type="node" ref="101" role=""/>
        <tag k="type" v="route"/><tag k="state" v="planned"/></relation>
      <relation id="503"><member type="relation" ref="101" role=""/>
        <tag k="type" v="route"/><tag k="state" v="planned"/></relation>
      <relation id="504"><member type="way" ref="101" role="forward"/>
        <member type="way" ref="101" role="backward"/><tag k="type" v="route"/>
        <tag k="route" v="railway"/><tag k="state" v="planned"/></relation>
      </osm>'''

    def run_extractor(self, negative_ids=False):
        source_xml = self.SOURCE
        if negative_ids:
            source_xml = source_xml.replace('id="101"', 'id="-101"').replace('ref="101"', 'ref="-101"')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'project.osm'
            source.write_text(source_xml)
            output = Path(directory) / 'features.geojson'
            ways = WayGeometryHandler()
            ways.apply_file(source, locations=True)
            expected = RelationHandler(ways.ways, ways.unrenderable_way_ids)
            expected.apply_file(source)

            seen, handlers = [], []
            original = RelationHandler.relation

            def record(handler, relation):
                seen.append(relation.id)
                handlers.append(handler)
                return original(handler, relation)

            args = SimpleNamespace(ways_file=source, source_file=source, output=output)
            with patch.object(linear, '_parse_args', return_value=args), \
                    patch.object(RelationHandler, 'relation', record), redirect_stdout(StringIO()):
                if negative_ids:
                    with patch.object(linear.osmium, 'IdTracker', side_effect=AssertionError('unsigned tracker')):
                        linear.main()
                else:
                    linear.main()
            self.assertTrue(output.exists())
            self.assertEqual(expected.relations, handlers[0].relations)
            self.assertEqual([101, 101] if not negative_ids else [-101, -101],
                             handlers[0].relations[504]['member_way_ids'])
            return seen

    def test_native_filter_skips_irrelevant_member_types_and_preserves_unrenderable_counts(self):
        self.assertEqual([501, 504], self.run_extractor())

    def test_temporary_negative_way_ids_keep_the_original_relation_scan(self):
        self.assertEqual([501, 502, 503, 504], self.run_extractor(negative_ids=True))


if __name__ == "__main__":
    unittest.main()
