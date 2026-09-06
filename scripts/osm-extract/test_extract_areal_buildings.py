import unittest

from extract_areal_buildings import classify_feature


class ClassifyFeatureTest(unittest.TestCase):
    def test_proposed_administrative_boundary_is_not_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'proposed',
            'proposed': 'administrative',
            'name': 'West Hertfordshire',
        }

        self.assertIsNone(classify_feature(tags))

    def test_active_administrative_boundary_with_lifecycle_tag_is_not_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'administrative',
            'proposed': 'yes',
            'name': 'Future District',
        }

        self.assertIsNone(classify_feature(tags))

    def test_administrative_lifecycle_values_are_not_projects(self):
        for lifecycle in ('construction', 'proposed', 'planned'):
            with self.subTest(lifecycle=lifecycle):
                tags = {
                    'type': 'boundary',
                    'boundary': lifecycle,
                    lifecycle: 'administrative',
                    'name': 'Future District',
                }

                self.assertIsNone(classify_feature(tags))

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

                self.assertIsNone(classify_feature(tags))

    def test_proposed_park_boundary_remains_a_project(self):
        tags = {
            'type': 'boundary',
            'boundary': 'protected_area',
            'proposed': 'park',
            'name': 'Future Park',
        }

        self.assertEqual('park', classify_feature(tags))

    def test_unknown_planned_type_remains_a_building_candidate(self):
        tags = {
            'planned': 'cultural_centre',
            'name': 'Future Cultural Centre',
        }

        self.assertEqual('building', classify_feature(tags))


if __name__ == '__main__':
    unittest.main()
