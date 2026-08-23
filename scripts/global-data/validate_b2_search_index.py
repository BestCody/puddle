#!/usr/bin/env python3
"""Validate an immutable B2 search snapshot and atomically activate it only after all gates pass."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import boto3
import brotli
from botocore.client import Config

from location_search_common import b2_source_config

PLANNER_BUILDER_PATH = Path(__file__).with_name('build_b2_search_planner_overlay.py')
PLANNER_VALIDATOR_PATH = Path(__file__).with_name('validate_b2_search_planner_overlay.py')
PLANNER_VERSION = 2
DEFAULT_PLANNER_TARGET_CANDIDATES = 4000
DEFAULT_PLANNER_TARGET_BYTES = 512 * 1024


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def hash_bucket(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:3]


def json_bytes(value) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def record_identity(record: dict) -> tuple[str, int, str]:
    key = str(record.get('key') or '')
    if not key:
        raise RuntimeError('Hash ledger contains an artifact with no key.')
    try:
        expected_size = int(record['compressed_bytes'])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f'Hash ledger contains an invalid compressed byte length: {key}') from error
    expected_sha = str(record.get('sha256') or '').lower()
    if expected_size < 0:
        raise RuntimeError(f'Hash ledger contains a negative compressed byte length: {key}')
    if len(expected_sha) != 64 or any(char not in '0123456789abcdef' for char in expected_sha):
        raise RuntimeError(f'Hash ledger contains an invalid SHA-256: {key}')
    return key, expected_size, expected_sha


def unique_ledger_records(records: list[dict]) -> tuple[list[dict], int, list[dict]]:
    unique: dict[str, dict] = {}
    exact_duplicates = 0
    conflicts: list[dict] = []
    for record in records:
        key, expected_size, expected_sha = record_identity(record)
        existing = unique.get(key)
        if existing is None:
            unique[key] = record
            continue
        _, existing_size, existing_sha = record_identity(existing)
        if (existing_size, existing_sha) == (expected_size, expected_sha):
            exact_duplicates += 1
            continue
        conflicts.append({
            'key': key,
            'first_size': existing_size,
            'first_sha': existing_sha,
            'conflicting_size': expected_size,
            'conflicting_sha': expected_sha,
        })
    return list(unique.values()), exact_duplicates, conflicts


def planner_configuration() -> tuple[int, int, int, str]:
    target_candidates = max(
        500,
        min(
            20_000,
            int(os.getenv('GLOBAL_LOCATION_PLANNER_TARGET_CANDIDATES', str(DEFAULT_PLANNER_TARGET_CANDIDATES))),
        ),
    )
    target_bytes = max(
        128 * 1024,
        min(
            2 * 1024 * 1024,
            int(os.getenv('GLOBAL_LOCATION_PLANNER_TARGET_BYTES', str(DEFAULT_PLANNER_TARGET_BYTES))),
        ),
    )
    workers = max(1, min(32, int(os.getenv('GLOBAL_LOCATION_PLANNER_WORKERS', '16'))))
    planner_id = f'v{PLANNER_VERSION}-c{target_candidates}-b{target_bytes}'
    explicit_id = str(os.getenv('GLOBAL_LOCATION_PLANNER_ID') or '').strip()
    if explicit_id and explicit_id != planner_id:
        raise RuntimeError(
            f'GLOBAL_LOCATION_PLANNER_ID={explicit_id!r} does not match normalized planner configuration {planner_id!r}.'
        )
    return target_candidates, target_bytes, workers, planner_id


def prepare_planner_candidate(snapshot: str, source, s3) -> tuple[str, str, str]:
    """Build/reuse and validate the bounded planner, then promote its candidate alias for parity."""
    target_candidates, target_bytes, workers, planner_id = planner_configuration()
    build_command = [
        sys.executable,
        str(PLANNER_BUILDER_PATH),
        f'--snapshot={snapshot}',
        f'--target-candidates={target_candidates}',
        f'--target-compressed-bytes={target_bytes}',
        f'--workers={workers}',
    ]
    print(
        f'planner_prepare_start snapshot={snapshot} planner_id={planner_id} '
        f'target_candidates={target_candidates} target_bytes={target_bytes}',
        flush=True,
    )
    subprocess.run(build_command, check=True)
    subprocess.run(
        [
            sys.executable,
            str(PLANNER_VALIDATOR_PATH),
            f'--snapshot={snapshot}',
            f'--planner-id={planner_id}',
        ],
        check=True,
    )

    planner_candidate_key = f'{source.data_prefix}/search/candidates/{snapshot}-{planner_id}.json'
    alias_key = f'{source.data_prefix}/search/candidates/{snapshot}.json'
    candidate_body = s3.get_object(Bucket=source.bucket, Key=planner_candidate_key)['Body'].read()
    candidate = json.loads(candidate_body)
    expected_manifest_key = f'{source.data_prefix}/search/schema=v1/snapshot={snapshot}/manifest-{planner_id}.json'
    if str(candidate.get('snapshot') or '') != snapshot:
        raise RuntimeError('Planner candidate pointer snapshot does not match requested snapshot.')
    if str(candidate.get('planner_id') or '') != planner_id:
        raise RuntimeError('Planner candidate pointer id does not match validated planner id.')
    if str(candidate.get('manifest_key') or '') != expected_manifest_key:
        raise RuntimeError('Planner candidate pointer manifest does not match validated planner manifest.')

    # This mutable candidate alias is what the existing migration parity step consumes.
    # The immutable base manifest remains untouched and can still be validated independently.
    s3.put_object(
        Bucket=source.bucket,
        Key=alias_key,
        Body=candidate_body,
        ContentType='application/json',
        CacheControl='no-store',
    )
    print(
        f'planner_candidate_promoted snapshot={snapshot} planner_id={planner_id} '
        f'candidate_key={planner_candidate_key} alias_key={alias_key}',
        flush=True,
    )
    return planner_id, planner_candidate_key, alias_key


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--activate', action='store_true')
    parser.add_argument('--head-workers', type=int, default=int(os.getenv('GLOBAL_LOCATION_VALIDATE_HEAD_WORKERS', '16')))
    parser.add_argument('--deep-hash-samples', type=int, default=int(os.getenv('GLOBAL_LOCATION_VALIDATE_DEEP_SAMPLES', '32')))
    args = parser.parse_args()

    source = b2_source_config()
    prefix = f'{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}'
    manifest_key = f'{prefix}/manifest.json'
    s3 = boto3.client(
        's3', endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id, aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(16, args.head_workers)),
    )

    def get_bytes(key: str) -> bytes:
        return s3.get_object(Bucket=source.bucket, Key=key)['Body'].read()

    def get_json(key: str, compressed: bool = False):
        body = get_bytes(key)
        raw = brotli.decompress(body) if compressed else body
        return json.loads(raw)

    manifest_body = get_bytes(manifest_key)
    manifest = json.loads(manifest_body)
    if int(manifest.get('schema_version', 0)) != 1:
        raise RuntimeError('Unsupported B2 search manifest schema.')
    if str(manifest.get('snapshot')) != args.snapshot:
        raise RuntimeError('Manifest snapshot does not match requested snapshot.')
    if int(manifest.get('location_count', 0)) <= 0:
        raise RuntimeError('Manifest contains no locations.')
    if int(manifest.get('published_count', 0)) <= 0:
        raise RuntimeError('Manifest contains no published locations.')

    validation = manifest.get('validation') or {}
    counts = get_json(validation['counts_key'], compressed=True)
    if int(counts.get('location_count', -1)) != int(manifest['location_count']):
        raise RuntimeError('Validation count does not match manifest location_count.')
    if int(counts.get('published_count', -1)) != int(manifest['published_count']):
        raise RuntimeError('Validation published count does not match manifest.')
    if int(counts.get('id_shards', 0)) <= 0 or int(counts.get('slug_shards', 0)) <= 0 or int(counts.get('geo_shards', 0)) <= 0:
        raise RuntimeError('Hydration and geographic shard families must all be non-empty.')

    hashes_body = get_bytes(validation['hashes_key'])
    if sha256_hex(hashes_body) != validation.get('hashes_sha256'):
        raise RuntimeError('Hash ledger checksum does not match manifest.')
    raw_records = json.loads(brotli.decompress(hashes_body))
    if len(raw_records) != int(validation.get('artifact_count', -1)):
        raise RuntimeError('Hash ledger artifact count does not match manifest.')
    if not raw_records:
        raise RuntimeError('Hash ledger is empty.')

    records, exact_duplicates, conflicts = unique_ledger_records(raw_records)
    print(
        f'ledger_records={len(raw_records)} unique_keys={len(records)} '
        f'exact_duplicate_records={exact_duplicates} conflicting_keys={len(conflicts)}',
        flush=True,
    )
    if conflicts:
        for conflict in conflicts[:50]:
            print(
                'ledger_conflict '
                f"key={conflict['key']} "
                f"first_size={conflict['first_size']} first_sha={conflict['first_sha']} "
                f"conflicting_size={conflict['conflicting_size']} conflicting_sha={conflict['conflicting_sha']}",
                flush=True,
            )
        if len(conflicts) > 50:
            print(f'ledger_conflicts_omitted={len(conflicts) - 50}', flush=True)
        raise RuntimeError(
            f'Hash ledger contains {len(conflicts)} destination keys with conflicting length/SHA-256 records.'
        )

    # HEAD every unique immutable artifact. The builder stores its locally computed SHA-256 as immutable B2 metadata;
    # this verifies object presence, byte length, and checksum metadata without downloading the entire index again.
    def verify_head(record: dict) -> None:
        key, expected_size, expected_sha = record_identity(record)
        head = s3.head_object(Bucket=source.bucket, Key=key)
        if int(head.get('ContentLength', -1)) != expected_size:
            raise RuntimeError(f'Length mismatch for {key}.')
        if str((head.get('Metadata') or {}).get('sha256', '')).lower() != expected_sha:
            raise RuntimeError(f'SHA-256 metadata mismatch for {key}.')

    workers = max(1, min(32, int(args.head_workers)))
    for start in range(0, len(records), 1000):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(verify_head, records[start:start + 1000]))
        print(f'head_validated={min(len(records), start + 1000)}/{len(records)}', flush=True)

    # Deterministic deep checksum sample catches any discrepancy between metadata and actual stored bytes.
    sample_count = max(1, min(len(records), int(args.deep_hash_samples)))
    samples = sorted(records, key=lambda record: hashlib.sha256(record['key'].encode()).digest())[:sample_count]
    for record in samples:
        if sha256_hex(get_bytes(record['key'])) != str(record['sha256']).lower():
            raise RuntimeError(f"Deep checksum mismatch for {record['key']}.")

    id_records = [record for record in records if record.get('kind') == 'id']
    route_records = [record for record in records if record.get('kind') == 'routing']
    if not id_records or not route_records:
        raise RuntimeError('Validation requires both ID and routing artifacts.')

    id_map = get_json(id_records[0]['key'], compressed=True)
    if not isinstance(id_map, dict) or not id_map:
        raise RuntimeError('ID shard did not decode to a non-empty map.')
    sample_id, sample_document = next(iter(id_map.items()))
    if str(sample_document.get('id')) != str(sample_id):
        raise RuntimeError('ID shard key and canonical document ID disagree.')
    sample_slug = str(sample_document.get('slug') or '').strip()
    if sample_slug:
        slug_key = f"{prefix}/slug/{hash_bucket(sample_slug)}.json.br"
        slug_map = get_json(slug_key, compressed=True)
        if str(slug_map.get(sample_slug)) != str(sample_id):
            raise RuntimeError('Slug shard does not resolve sample slug back to its ID.')

    route = get_json(route_records[0]['key'], compressed=True)
    if not isinstance(route, list) or not route:
        raise RuntimeError('Routing shard did not decode to a non-empty list.')
    descriptor = route[0]
    geo_key = descriptor[0] if isinstance(descriptor, list) else descriptor.get('key')
    geo_documents = get_json(geo_key, compressed=True)
    if not isinstance(geo_documents, list) or not geo_documents:
        raise RuntimeError('Geo route target did not decode to a non-empty document list.')

    report = {
        'schema_version': 1,
        'snapshot': args.snapshot,
        'validated_at': utc_now(),
        'location_count': manifest['location_count'],
        'published_count': manifest['published_count'],
        'artifact_count': len(raw_records),
        'unique_artifact_keys': len(records),
        'exact_duplicate_ledger_records': exact_duplicates,
        'deep_hash_samples': sample_count,
        'checks': {
            'manifest': True,
            'counts': True,
            'ledger_key_consistency': True,
            'artifact_presence_length_sha256_metadata': True,
            'deep_hash_sample': True,
            'id_lookup': True,
            'slug_lookup': bool(sample_slug),
            'geo_route': True,
        },
    }
    report_key = f'{prefix}/validation/report.json'
    s3.put_object(Bucket=source.bucket, Key=report_key, Body=json_bytes(report), ContentType='application/json', CacheControl='no-store')

    if not args.activate:
        planner_id, planner_candidate_key, candidate_alias_key = prepare_planner_candidate(args.snapshot, source, s3)
        report['planner_id'] = planner_id
        report['planner_candidate_key'] = planner_candidate_key
        report['candidate_alias_key'] = candidate_alias_key
        report['checks']['planner_overlay'] = True
        s3.put_object(Bucket=source.bucket, Key=report_key, Body=json_bytes(report), ContentType='application/json', CacheControl='no-store')
        print(json.dumps(report, indent=2, sort_keys=True), flush=True)
        return

    # Activation follows the exact candidate pointer that already passed the workflow parity gate.
    # If it names a planner overlay, delegate to the strict planner validator/activator instead of
    # silently switching active.json back to the coarse base manifest.
    candidate_alias_key = f'{source.data_prefix}/search/candidates/{args.snapshot}.json'
    candidate = get_json(candidate_alias_key)
    candidate_planner_id = str(candidate.get('planner_id') or '').strip()
    candidate_manifest_key = str(candidate.get('manifest_key') or '').strip()
    if candidate_planner_id:
        expected_prefix = f'{prefix}/manifest-'
        if str(candidate.get('snapshot') or '') != args.snapshot:
            raise RuntimeError('Parity-passing candidate pointer snapshot changed before activation.')
        if not candidate_manifest_key.startswith(expected_prefix) or not candidate_manifest_key.endswith('.json'):
            raise RuntimeError('Parity-passing planner candidate points outside the snapshot planner namespace.')
        print(
            f'planner_activation_delegate snapshot={args.snapshot} planner_id={candidate_planner_id} '
            f'manifest_key={candidate_manifest_key}',
            flush=True,
        )
        subprocess.run(
            [
                sys.executable,
                str(PLANNER_VALIDATOR_PATH),
                f'--snapshot={args.snapshot}',
                f'--planner-id={candidate_planner_id}',
                f'--manifest-key={candidate_manifest_key}',
                '--activate',
            ],
            check=True,
        )
        report['activated'] = True
        report['active_key'] = f'{source.data_prefix}/search/active.json'
        report['planner_id'] = candidate_planner_id
        report['activated_manifest_key'] = candidate_manifest_key
        print(json.dumps(report, indent=2, sort_keys=True), flush=True)
        return

    active_key = f'{source.data_prefix}/search/active.json'
    previous = None
    try:
        previous = json.loads(get_bytes(active_key))
    except s3.exceptions.NoSuchKey:
        previous = None
    except Exception as error:
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        if code not in {'NoSuchKey', '404', 'NotFound'}:
            raise
    activated = {
        'schema_version': 1,
        'snapshot': args.snapshot,
        'manifest_key': manifest_key,
        'activated_at': utc_now(),
        'validation_report_key': report_key,
    }
    if previous:
        history_stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        history = {'previous': previous, 'replacement': activated}
        s3.put_object(
            Bucket=source.bucket,
            Key=f'{source.data_prefix}/search/history/{history_stamp}.json',
            Body=json_bytes(history), ContentType='application/json',
            CacheControl='public,max-age=31536000,immutable',
        )
    # Single-object replacement is the only mutable operation in the search namespace.
    s3.put_object(Bucket=source.bucket, Key=active_key, Body=json_bytes(activated), ContentType='application/json', CacheControl='no-store')
    report['activated'] = True
    report['active_key'] = active_key

    print(json.dumps(report, indent=2, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
