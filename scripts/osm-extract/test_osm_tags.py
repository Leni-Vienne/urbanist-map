from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from osm_tags import tags_to_dict


class TagsToDictTest(unittest.TestCase):
    def test_fallback_preserves_values_order_and_last_duplicate(self):
        tags = [SimpleNamespace(k=key, v=value) for key, value in (
            ('name', 'Old name'), ('name:ja', '地図'), ('name', 'Ångström'),
        )]
        result = tags_to_dict(tags)
        self.assertEqual({'name': 'Ångström', 'name:ja': '地図'}, result)
        self.assertEqual(['name', 'name:ja'], list(result))
        result['name'] = 'Changed'
        self.assertEqual('Ångström', tags[-1].v)
        self.assertEqual({}, tags_to_dict([]))

    def test_prefers_native_copy_without_iterating(self):
        tags = SimpleNamespace(to_dict=Mock(return_value={'name': 'Ångström'}))
        self.assertEqual({'name': 'Ångström'}, tags_to_dict(tags))
        tags.to_dict.assert_called_once_with()

    def test_native_errors_propagate(self):
        tags = SimpleNamespace(to_dict=Mock(side_effect=AttributeError('Invalid tag data')))
        with self.assertRaisesRegex(AttributeError, 'Invalid tag data'):
            tags_to_dict(tags)


if __name__ == '__main__':
    unittest.main()
