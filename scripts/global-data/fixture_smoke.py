#!/usr/bin/env python3
"""No-key smoke test for global-data identity, slug, and photo-priority contracts.

This intentionally uses only local fixture data and the Python standard library. It
exercises invariants that must hold before any production B2/provider/search access
is attempted.
"""
import json
import math
import re
import uuid
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'global-data' / 'platform-smoke.json'


def name_key(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def approx_distance_m(a, b):
    lat_m = (float(a['latitude']) - float(b['latitude'])) * 111_320
    mean_lat = math.radians((float(a['latitude']) + float(b['latitude'])) / 2)
    lon_m = (float(a['longitude']) - float(b['longitude'])) * 111_320 * math.cos(mean_lat)
    return math.hypot(lat_m, lon_m)


def matching_overture(fsq, overture):
    candidates = []
    for row in overture:
        if name_key(row['name']) != name_key(fsq['name']) or row['category'] != fsq['category']:
            continue
        if abs(float(fsq['latitude']) - float(row['latitude'])) > 0.0015:
            continue
        if abs(float(fsq['longitude']) - float(row['longitude'])) > 0.0015:
            continue
        candidates.append((approx_distance_m(fsq, row), row))
    return min(candidates, key=lambda item: (item[0], item[1]['source_id']))[1] if candidates else None


def photo_choice(category, candidates):
    scenic = {'park', 'museum', 'gallery', 'attraction', 'scenic_spot'}
    if category in scenic:
        provider_order = {'wikimedia-commons': 0, 'mapillary': 1, 'kartaview': 2}
    else:
        provider_order = {'mapillary': 0, 'wikimedia-commons': 1, 'kartaview': 2}
    return min(
        candidates,
        key=lambda row: (provider_order.get(row['provider'], 3), -float(row.get('rank_score') or 0), row['provider']),
    )['provider']


def collision_safe_slugs(rows):
    """Reference model for the SQL projection's deterministic duplicate-slug policy."""
    counts = Counter(str(row['slug']) for row in rows if str(row.get('slug') or '').strip())
    winners = {}
    for row in rows:
        slug = str(row.get('slug') or '').strip()
        if slug and counts[slug] > 1:
            identifier = str(row['id'])
            winners[slug] = min(identifier, winners.get(slug, identifier))

    resolved = {}
    for row in rows:
        identifier = str(row['id'])
        slug = str(row.get('slug') or '').strip()
        if slug and slug in winners and identifier != winners[slug]:
            slug = f"{slug}-{identifier.replace('-', '')}"
        if slug in resolved and resolved[slug] != identifier:
            raise AssertionError(f'second-order slug collision for {slug}')
        resolved[slug] = identifier
    return resolved


def assert_slug_collision_regression():
    # This is the exact collision that stopped the 29,899,219-row production build.
    first = 'f68941ee-ba28-5cbd-ae22-4496f8822175'
    second = 'f68941ee-67eb-5c5e-a152-9e288eeb2f62'
    original = 'place-f68941ee'
    rows = [
        {'id': first, 'slug': original},
        {'id': second, 'slug': original},
        {'id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'slug': 'already-unique'},
    ]
    resolved = collision_safe_slugs(rows)
    winner = min(first, second)
    loser = max(first, second)
    expected_loser_slug = f"{original}-{loser.replace('-', '')}"
    assert resolved[original] == winner, 'duplicate slug winner must be deterministic'
    assert resolved[expected_loser_slug] == loser, 'duplicate slug loser must receive its full UUID suffix'
    assert resolved['already-unique'] == 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'non-conflicting slugs must remain stable'
    assert len(resolved) == len(rows), 'slug collision policy must remain one-to-one with canonical IDs'

    # Keep the fixture tied to the production SQL rather than testing only a copy.
    common = (ROOT / 'scripts' / 'global-data' / 'location_search_common.py').read_text(encoding='utf-8')
    for marker in (
        'slug_collision_winners',
        'HAVING count(*) > 1',
        "min(cast(id AS VARCHAR)) AS winner_id",
        "replace(cast(l.id AS VARCHAR), '-', '')",
    ):
        assert marker in common, f'canonical slug collision projection is missing {marker}'


def main():
    fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
    namespace = uuid.UUID(fixture['namespace'])
    bootstrap = {(row['source'], row['source_id']): row['location_id'] for row in fixture['bootstrapLinks']}

    overture_canonical = {}

    # Existing Overture identity wins. If only a matched FSQ identity existed, it
    # would be inherited; otherwise create a deterministic source-addressed UUIDv5.
    for row in fixture['overture']:
        known = bootstrap.get(('overture', row['source_id']))
        matched_fsq_ids = [
            fsq['source_id'] for fsq in fixture['fsq']
            if (matching_overture(fsq, fixture['overture']) or {}).get('source_id') == row['source_id']
        ]
        inherited = next((bootstrap.get(('fsq_os', source_id)) for source_id in matched_fsq_ids if bootstrap.get(('fsq_os', source_id))), None)
        overture_canonical[row['source_id']] = known or inherited or str(uuid.uuid5(namespace, f"overture:{row['source_id']}"))

    crosswalk = []
    for row in fixture['overture']:
        crosswalk.append(('overture', row['source_id'], overture_canonical[row['source_id']]))

    for row in fixture['fsq']:
        match = matching_overture(row, fixture['overture'])
        if match:
            canonical = overture_canonical[match['source_id']]
        else:
            canonical = bootstrap.get(('fsq_os', row['source_id'])) or str(uuid.uuid5(namespace, f"fsq_os:{row['source_id']}"))
        crosswalk.append(('fsq_os', row['source_id'], canonical))

    existing_id = '11111111-1111-4111-8111-111111111111'
    fsq_old_id = '22222222-2222-4222-8222-222222222222'
    assert overture_canonical['ov-existing'] == existing_id, 'existing Puddle UUID was not preserved'

    fsq_existing = next(row for row in crosswalk if row[0] == 'fsq_os' and row[1] == 'fsq-existing')
    assert fsq_existing[2] == existing_id, 'matched FSQ record did not inherit canonical Overture/Puddle identity'
    assert fsq_existing[2] != fsq_old_id, 'duplicate historical FSQ UUID should become an alias, not the canonical ID'

    expected_new_park = str(uuid.uuid5(namespace, 'overture:ov-new-park'))
    assert overture_canonical['ov-new-park'] == expected_new_park, 'new Overture UUID is not deterministic UUIDv5'
    assert str(uuid.uuid5(namespace, 'overture:ov-new-park')) == expected_new_park, 'deterministic UUID changed across repeated calculation'

    fsq_new = next(row for row in crosswalk if row[0] == 'fsq_os' and row[1] == 'fsq-new-venue')
    assert fsq_new[2] == str(uuid.uuid5(namespace, 'fsq_os:fsq-new-venue')), 'unmatched FSQ location did not receive deterministic UUIDv5'

    aliases = []
    for source, source_id, canonical in crosswalk:
        old = bootstrap.get((source, source_id))
        if old and old != canonical:
            aliases.append((old, canonical))
    assert (fsq_old_id, existing_id) in aliases, 'historical duplicate ID alias was not preserved'

    canonical_ids = {row[2] for row in crosswalk}
    assert len(canonical_ids) == 3, f'fixture expected 3 canonical locations, got {len(canonical_ids)}'

    assert_slug_collision_regression()

    for case in fixture['photoPriorityCases']:
        chosen = photo_choice(case['category'], case['candidates'])
        assert chosen == case['expected'], f"{case['category']} chose {chosen}, expected {case['expected']}"

    print(json.dumps({
        'ok': True,
        'fixture': str(FIXTURE.relative_to(ROOT)),
        'sourceLinks': len(crosswalk),
        'canonicalLocations': len(canonical_ids),
        'aliases': len(aliases),
        'slugCollisionRegression': True,
        'photoPriorityCases': len(fixture['photoPriorityCases']),
    }, indent=2))


if __name__ == '__main__':
    main()
