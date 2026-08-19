#!/usr/bin/env python3
"""Validate an immutable B2 search snapshot and atomically activate it only after all gates pass."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
import brotli
from botocore.client import Config

from location_search_common import b2_source_config


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def hash_bucket(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:3]


def json_bytes(value) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


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
    records = json.loads(brotli.decompress(hashes_body))
    if len(records) != int(validation.get('artifact_count', -1)):
        raise RuntimeError('Hash ledger artifact count does not match manifest.')
    if not records:
        raise RuntimeError('Hash ledger is empty.')

    # HEAD every immutable artifact. The builder stores its locally computed SHA-256 as immutable B2 metadata;
    # this verifies object presence, byte length, and checksum metadata without downloading the entire index again.
    def verify_head(record: dict) -> None:
        head = s3.head_object(Bucket=source.bucket, Key=record['key'])
        if int(head.get('ContentLength', -1)) != int(record['compressed_bytes']):
            raise RuntimeError(f"Length mismatch for {record['key']}.")
        if str((head.get('Metadata') or {}).get('sha256', '')).lower() != str(record['sha256']).lower():
            raise RuntimeError(f"SHA-256 metadata mismatch for {record['key']}.")

    workers = max(1, min(32, int(args.head_workers)))
    for start in range(0, len(records), 1000):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(verify_head, records[start:start + 1000]))
        print(f'head_validated={min(len(records), start + 1000)}/{len(records)}', flush=True)

    # Deterministic deep checksum sample catches any discrepancy between metadata and actual stored bytes.
    sample_count = max(1, min(len(records), int(args.deep_hash_samples)))
    samples = sorted(records, key=lambda record: hashlib.sha256(record['key'].encode()).digest())[:sample_count]
    for record in samples:
        if sha256_hex(get_bytes(record['key'])) != record['sha256']:
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
        'artifact_count': len(records),
        'deep_hash_samples': sample_count,
        'checks': {
            'manifest': True,
            'counts': True,
            'artifact_presence_length_sha256_metadata': True,
            'deep_hash_sample': True,
            'id_lookup': True,
            'slug_lookup': bool(sample_slug),
            'geo_route': True,
        },
    }
    report_key = f'{prefix}/validation/report.json'
    s3.put_object(Bucket=source.bucket, Key=report_key, Body=json_bytes(report), ContentType='application/json', CacheControl='no-store')

    if args.activate:
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
