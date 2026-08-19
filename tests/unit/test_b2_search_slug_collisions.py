import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[2] / 'scripts' / 'global-data'
sys.path.insert(0, str(SCRIPT_DIR))
SPEC = importlib.util.spec_from_file_location('build_b2_search_index', SCRIPT_DIR / 'build_b2_search_index.py')
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class B2SearchSlugCollisionTests(unittest.TestCase):
    def test_exact_production_collision_is_deterministically_disambiguated(self):
        first = 'f68941ee-ba28-5cbd-ae22-4496f8822175'
        second = 'f68941ee-67eb-5c5e-a152-9e288eeb2f62'

        entries = MODULE.resolved_slug_entries('place-f68941ee', [first, second])

        self.assertEqual(
            entries,
            [
                ('place-f68941ee', second),
                ('place-f68941ee-f68941eeba285cbdae224496f8822175', first),
            ],
        )
        self.assertEqual(len({slug for slug, _ in entries}), 2)
        self.assertEqual(len({identifier for _, identifier in entries}), 2)

    def test_input_order_and_duplicates_do_not_change_resolution(self):
        identifiers = [
            'f68941ee-ba28-5cbd-ae22-4496f8822175',
            'f68941ee-67eb-5c5e-a152-9e288eeb2f62',
        ]
        expected = MODULE.resolved_slug_entries('place-f68941ee', identifiers)
        actual = MODULE.resolved_slug_entries('place-f68941ee', [identifiers[1], identifiers[0], identifiers[1]])
        self.assertEqual(actual, expected)

    def test_non_collision_keeps_existing_slug_unchanged(self):
        identifier = '11111111-2222-3333-4444-555555555555'
        self.assertEqual(
            MODULE.resolved_slug_entries('existing-public-slug', [identifier]),
            [('existing-public-slug', identifier)],
        )


if __name__ == '__main__':
    unittest.main()
