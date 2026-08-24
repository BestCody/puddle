#!/usr/bin/env python3
"""Build a compact immutable text-search projection from the active packed B2 geo objects.

This is a serving-only derivative. It never rebuilds the canonical/base index. Each
physical geo object receives a deterministic Zstd-compressed positional projection,
then a candidate marker is published. Production activation is a separate operation
so parity can gate the ready marker.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import boto3
import brotli
import orjson
import zstandard as zstd
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config

PROJECTION_VERSION = 1
DEFAULT_WORKERS = 16
ASCII_NON_ALNUM = re.compile(r'[^a-z0-9]+')
ASCII_WHITESPACE = re.compile(r'\s+')


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get('Error', {}).get('Code') or '')
    status = int(error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') or 0)
    return code in {'404', 'NoSuchKey', 'NotFound'} or status == 404


def ascii_normalized(value) -> str | None:
    if value is None:
        return ''
    text = str(value)
    if not text.isascii():
        return None
    normalized = ASCII_NON_ALNUM.sub(' ', text.lower()).strip()
    return ASCII_WHITESPACE.sub(' ', normalized)


def normalized_aliases(values) -> list[str | None]:
    if not isinstance(values, list):
        return []
    return [ascii_normalized(value) for value in values]


def compact_photo(document: dict):
    photo = document.get('primary_photo')
    if not isinstance(photo, dict) or not photo.get('content_hash'):
        return None
    return [
        photo.get('content_hash'),
        photo.get('provider'),
        photo.get('attribution'),
        photo.get('attribution_url'),
        photo.get('license'),
        photo.get('width'),
        photo.get('height'),
    ]


def project_document(document: dict) -> list:
    aliases = document.get('aliases') if isinstance(document.get('aliases'), list) else []
    return [
        document.get('id'),
        document.get('slug'),
        document.get('name'),
        aliases,
        document.get('summary'),
        document.get('description'),
        document.get('category'),
        document.get('subcategory'),
        document.get('latitude'),
        document.get('longitude'),
        document.get('country'),
        document.get('country_code'),
        document.get('region'),
        document.get('region_code'),
        document.get('city'),
        document.get('neighborhood'),
        document.get('postal_code'),
        document.get('address'),
        document.get('timezone'),
        bool(document.get('timezone_verified')),
        document.get('opening_hours') if isinstance(document.get('opening_hours'), dict) else {},
        document.get('price_level'),
        document.get('amenities') if isinstance(document.get('amenities'), list) else [],
        document.get('accessibility') if isinstance(document.get('accessibility'), dict) else {},
        bool(document.get('accessible')),
        document.get('website_url'),
        document.get('phone_public'),
        document.get('brand_id'),
        document.get('brand_name'),
        document.get('source_parent_place_id'),
        document.get('duplicate_group_key'),
        document.get('catalogue_group_key'),
        float(document.get('quality_score') or 0),
        float(document.get('popularity_score') or 0),
        document.get('google_place_id'),
        document.get('google_place_match_score'),
        document.get('status'),
        document.get('updated_at'),
        compact_photo(document),
        ascii_normalized(document.get('name')),
        normalized_aliases(aliases),
        ascii_normalized(document.get('category')),
        ascii_normalized(document.get('city')),
        ascii_normalized(document.get('neighborhood')),
        ascii_normalized(document.get('address')),
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-key', required=True)
    parser.add_argument('--planner-id', required=True)
    parser.add_argument('--workers', type=int, default=int(os.getenv('GLOBAL_LOCATION_PLANNER_WORKERS', str(DEFAULT_WORKERS))))
    parser.add_argument('--activate-only', action='store_true')
    args = parser.parse_args()

    manifest_key = str(args.manifest_key).strip().lstrip('/')
    planner_id = str(args.planner_id).strip()
    if not manifest_key or not re.fullmatch(r'[A-Za-z0-9._-]+', planner_id):
        raise RuntimeError('A valid manifest key and planner id are required.')
    workers = max(1, min(32, int(args.workers)))

    source = b2_source_config()
    s3 = boto3.client(
        's3',
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(32, workers * 2)),
    )

    def get_bytes(key: str) -> bytes:
        return s3.get_object(Bucket=source.bucket, Key=key)['Body'].read()

    manifest_body = get_bytes(manifest_key)
    manifest_sha = sha256_hex(manifest_body)
    manifest = orjson.loads(manifest_body)
    if int(manifest.get('schema_version') or 0) != 1:
        raise RuntimeError('Text projection requires B2 search schema version 1.')
    if str((manifest.get('planner') or {}).get('id') or '') != planner_id:
        raise RuntimeError('Text projection planner id does not match the source manifest.')
    prefix = str(manifest.get('prefix') or '').strip().rstrip('/')
    if not prefix:
        raise RuntimeError('Source manifest does not define a serving prefix.')

    projection_base = f'{prefix}/text-projection-v{PROJECTION_VERSION}/{planner_id}'
    candidate_key = f'{projection_base}/candidate.json'
    ready_key = f'{projection_base}/ready.json'

    if args.activate_only:
        candidate_body = get_bytes(candidate_key)
        candidate = orjson.loads(candidate_body)
        if (
            int(candidate.get('schema_version') or 0) != 1
            or int(candidate.get('projection_version') or 0) != PROJECTION_VERSION
            or str(candidate.get('source_manifest_key') or '') != manifest_key
            or str(candidate.get('source_manifest_sha256') or '') != manifest_sha
            or str(candidate.get('planner_id') or '') != planner_id
        ):
            raise RuntimeError('Text projection candidate does not match the requested active manifest.')
        ready_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
        digest = sha256_hex(ready_body)
        try:
            head = s3.head_object(Bucket=source.bucket, Key=ready_key)
        except ClientError as error:
            if not is_missing(error):
                raise
            s3.put_object(
                Bucket=source.bucket,
                Key=ready_key,
                Body=ready_body,
                ContentType='application/json',
                CacheControl='public,max-age=31536000,immutable',
                Metadata={'sha256': digest},
            )
        else:
            existing = get_bytes(ready_key)
            if existing != ready_body or str((head.get('Metadata') or {}).get('sha256') or '').lower() != digest:
                raise RuntimeError(f'Immutable text projection ready marker differs: {ready_key}')
        print(f'text_projection_activated=true ready_key={ready_key} objects={candidate.get("object_count")} rows={candidate.get("location_rows")}', flush=True)
        return

    validation = manifest.get('validation') or {}
    hashes_key = str(validation.get('hashes_key') or '')
    hashes_sha = str(validation.get('hashes_sha256') or '').lower()
    if not hashes_key or not hashes_sha:
        raise RuntimeError('Source manifest does not provide a validated hash ledger.')
    hashes_body = get_bytes(hashes_key)
    if sha256_hex(hashes_body) != hashes_sha:
        raise RuntimeError('Source manifest hash ledger checksum mismatch.')
    records = orjson.loads(brotli.decompress(hashes_body))
    geo_records = sorted(
        (record for record in records if isinstance(record, dict) and record.get('kind') == 'geo'),
        key=lambda record: str(record.get('key') or ''),
    )
    if not geo_records:
        raise RuntimeError('Source manifest contains no physical geo objects.')

    compressor = zstd.ZstdCompressor(level=6, threads=0)

    def projection_key(source_key: str) -> str:
        digest = hashlib.sha256(source_key.encode()).hexdigest()
        return f'{projection_base}/objects/{digest}.json.zst'

    def process(record: dict) -> dict:
        source_key = str(record.get('key') or '')
        source_sha = str(record.get('sha256') or '').lower()
        expected_count = int(record.get('count') or 0)
        if not source_key or not source_sha or expected_count < 0:
            raise RuntimeError(f'Invalid geo hash-ledger record: {record!r}')
        target_key = projection_key(source_key)

        try:
            head = s3.head_object(Bucket=source.bucket, Key=target_key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            metadata = head.get('Metadata') or {}
            if (
                str(metadata.get('source-sha256') or '').lower() != source_sha
                or int(metadata.get('projection-version') or 0) != PROJECTION_VERSION
                or int(metadata.get('count') or -1) != expected_count
            ):
                raise RuntimeError(f'Existing immutable text projection metadata differs: {target_key}')
            return {
                'source_bytes': int(record.get('compressed_bytes') or 0),
                'projection_bytes': int(head.get('ContentLength') or 0),
                'rows': expected_count,
                'reused': 1,
            }

        body = get_bytes(source_key)
        if sha256_hex(body) != source_sha:
            raise RuntimeError(f'Source geo object checksum mismatch: {source_key}')
        documents = orjson.loads(brotli.decompress(body))
        if not isinstance(documents, list) or len(documents) != expected_count:
            raise RuntimeError(f'Source geo object count mismatch: {source_key}')
        rows = [project_document(document) for document in documents]
        raw = orjson.dumps([PROJECTION_VERSION, rows])
        projected = compressor.compress(raw)
        projected_sha = sha256_hex(projected)
        s3.put_object(
            Bucket=source.bucket,
            Key=target_key,
            Body=projected,
            ContentType='application/zstd',
            CacheControl='public,max-age=31536000,immutable',
            Metadata={
                'sha256': projected_sha,
                'source-sha256': source_sha,
                'projection-version': str(PROJECTION_VERSION),
                'count': str(expected_count),
                'uncompressed-bytes': str(len(raw)),
            },
        )
        return {
            'source_bytes': int(record.get('compressed_bytes') or len(body)),
            'projection_bytes': len(projected),
            'rows': len(rows),
            'reused': 0,
        }

    source_bytes = 0
    projection_bytes = 0
    location_rows = 0
    reused = 0
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process, record) for record in geo_records]
        for future in as_completed(futures):
            result = future.result()
            source_bytes += int(result['source_bytes'])
            projection_bytes += int(result['projection_bytes'])
            location_rows += int(result['rows'])
            reused += int(result['reused'])
            completed += 1
            if completed % 100 == 0 or completed == len(geo_records):
                print(
                    f'text_projection_progress objects={completed}/{len(geo_records)} rows={location_rows} '
                    f'source_bytes={source_bytes} projection_bytes={projection_bytes} reused={reused}',
                    flush=True,
                )

    expected_locations = int(manifest.get('location_count') or 0)
    if expected_locations and location_rows != expected_locations:
        raise RuntimeError(f'Text projection row count {location_rows} does not match manifest location_count {expected_locations}.')

    candidate = {
        'schema_version': 1,
        'projection_version': PROJECTION_VERSION,
        'source_manifest_key': manifest_key,
        'source_manifest_sha256': manifest_sha,
        'planner_id': planner_id,
        'snapshot': manifest.get('snapshot') or manifest.get('source_snapshot'),
        'object_count': len(geo_records),
        'location_rows': location_rows,
        'source_compressed_bytes': source_bytes,
        'projection_compressed_bytes': projection_bytes,
        'compression_ratio': round(projection_bytes / source_bytes, 6) if source_bytes else None,
        'built_at': utc_now(),
    }
    candidate_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
    s3.put_object(
        Bucket=source.bucket,
        Key=candidate_key,
        Body=candidate_body,
        ContentType='application/json',
        CacheControl='no-store',
    )
    print(
        f'text_projection_complete=true candidate_key={candidate_key} objects={len(geo_records)} rows={location_rows} '
        f'source_bytes={source_bytes} projection_bytes={projection_bytes} ratio={candidate["compression_ratio"]}',
        flush=True,
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)


if __name__ == '__main__':
    main()
