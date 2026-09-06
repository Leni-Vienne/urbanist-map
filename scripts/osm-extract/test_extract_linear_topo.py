import unittest
from types import SimpleNamespace

from extract_linear_topo import RelationHandler


class RelationHandlerTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
