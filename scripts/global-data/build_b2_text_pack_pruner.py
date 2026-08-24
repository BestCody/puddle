#!/usr/bin/env python3
"""Build routing-tile text-prune sidecars for the packed B2 search planner.

This is a serving-only derivative of the already-built packed B2 index. It never
changes or rebuilds canonical/base location data. Each physical pack receives an
exact set of three-character ASCII token prefixes plus conservative score maxima.
Routing-tile sidecars map those signatures to the physical packs visible in the
existing routing object. Candidate publication and activation are separate.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import brotli
import orjson
import zstandard as zstd
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config

PRUNER_VERSION = 1
PREFIX_LENGTH = 3
SIGNATURE_FORMAT = 'prefix3-indices-v1'
ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
ALPHABET_INDEX = {char: index for index, char in enumerate(ALPHABET)}
DEFAULT_WORKERS = 24


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get('Error', {}).get('Code') or '')
    status = int(error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') or 0)
    return code in {'404', 'NoSuchKey', 'NotFound'} or status == 404


def normalized_tokens(value) -> list[str]:
    if value is None:
        return []
    raw = unicodedata.normalize('NFKD', str(value))
    chars: list[str] = []
    for char in raw:
        if unicodedata.category(char).startswith('M'):
            continue
        lowered = char.lower()
        chars.append(lowered if lowered.isalnum() else ' ')
    return ''.join(chars).split()


def prefix_index(token: str) -> int | None:
    if len(token) < PREFIX_LENGTH:
        return None
    value = 0
    for char in token[:PREFIX_LENGTH]:
        digit = ALPHABET_INDEX.get(char)
        if digit is None:
            return None
        value = value * len(ALPHABET) + digit
    return value


def add_field(signature: set[int], value) -> None:
    for token in normalized_tokens(value):
        index = prefix_index(token)
        if index is not None:
            signature.add(index)


def signature_from_documents(documents: list[dict]) -> tuple[list[int], float, float, bool]:
    signature: set[int] = set()
    max_quality = 0.0
    max_popularity = 0.0
    has_photo = False
    for document in documents:
        if not isinstance(document, dict) or str(document.get('status') or '') != 'published':
            continue
        for field in ('name', 'category', 'city', 'neighborhood', 'address'):
            add_field(signature, document.get(field))
        aliases = document.get('aliases')
        if isinstance(aliases, list):
            for alias in aliases:
                add_field(signature, alias)
        try:
            max_quality = max(max_quality, max(0.0, float(document.get('quality_score') or 0)))
        except (TypeError, ValueError):
            pass
        try:
            max_popularity = max(max_popularity, max(0.0, float(document.get('popularity_score') or 0)))
        except (TypeError, ValueError):
            pass
        photo = document.get('primary_photo')
        has_photo = has_photo or (isinstance(photo, dict) and bool(photo.get('content_hash')))
    return sorted(signature), max_quality, max_popularity, has_photo


def signature_from_projection_rows(rows: list) -> tuple[list[int], float, float, bool]:
    # Mirrors TEXT_CORE_INDEX in lib/app/b2-text-search-projection.js.
    signature: set[int] = set()
    max_quality = 0.0
    max_popularity = 0.0
    has_photo = False
    for row in rows:
        if not isinstance(row, list) or len(row) < 22 or str(row[15] or '') != 'published':
            continue
        normalized_fields = [row[16], row[18], row[19], row[20], row[21]]
        normalized_aliases = row[17] if isinstance(row[17], list) else []
        for value in normalized_fields:
            if value is None:
                continue
            for token in str(value).split():
                index = prefix_index(token)
                if index is not None:
                    signature.add(index)
        for value in normalized_aliases:
            if value is None:
                continue
            for token in str(value).split():
                index = prefix_index(token)
                if index is not None:
                    signature.add(index)
        # Non-ASCII build-time projection fields are stored as null; reconstruct them
        # from the raw compact fields so pruning never gains a false negative.
        if any(value is None for value in normalized_fields):
            for raw_index in (1, 3, 6, 7, 8):
                add_field(signature, row[raw_index])
        for index, raw_alias in enumerate(row[2] if isinstance(row[2], list) else []):
            if index >= len(normalized_aliases) or normalized_aliases[index] is None:
                add_field(signature, raw_alias)
        try:
            max_quality = max(max_quality, max(0.0, float(row[12] or 0)))
        except (TypeError, ValueError):
            pass
        try:
            max_popularity = max(max_popularity, max(0.0, float(row[13] or 0)))
        except (TypeError, ValueError):
            pass
        has_photo = has_photo or bool(row[14])
    return sorted(signature), max_quality, max_popularity, has_photo


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-key', required=True)
    parser.add_argument('--planner-id', required=True)
    parser.add_argument('--workers', type=int, default=int(os.getenv('GLOBAL_LOCATION_TEXT_PRUNE_WORKERS', str(DEFAULT_WORKERS))))
    parser.add_argument('--activate-only', action='store_true')
    args = parser.parse_args()

    manifest_key = str(args.manifest_key).strip().lstrip('/')
    planner_id = str(args.planner_id).strip()
    workers = max(1, min(32, int(args.workers)))
    if not manifest_key or not re.fullmatch(r'[A-Za-z0-9._-]+', planner_id):
        raise RuntimeError('A valid manifest key and planner id are required.')

    source = b2_source_config()
    s3 = boto3.client(
        's3',
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(64, workers * 3)),
    )

    def get_bytes(key: str) -> bytes:
        return s3.get_object(Bucket=source.bucket, Key=key)['Body'].read()

    def get_optional_bytes(key: str) -> bytes | None:
        try:
            return get_bytes(key)
        except ClientError as error:
            if is_missing(error):
                return None
            raise

    def put_immutable(key: str, body: bytes, *, content_type: str, metadata: dict[str, str]) -> None:
        digest = sha256_hex(body)
        expected = {**metadata, 'sha256': digest}
        try:
            head = s3.head_object(Bucket=source.bucket, Key=key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            actual = {str(k).lower(): str(v) for k, v in (head.get('Metadata') or {}).items()}
            if int(head.get('ContentLength') or -1) != len(body) or any(actual.get(k.lower()) != str(v) for k, v in expected.items()):
                raise RuntimeError(f'Immutable text-prune artifact differs: {key}')
            return
        s3.put_object(
            Bucket=source.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl='public,max-age=31536000,immutable',
            Metadata=expected,
        )

    manifest_body = get_bytes(manifest_key)
    manifest_sha = sha256_hex(manifest_body)
    manifest = orjson.loads(manifest_body)
    if int(manifest.get('schema_version') or 0) != 1:
        raise RuntimeError('Text pruner requires B2 search schema version 1.')
    if str((manifest.get('planner') or {}).get('id') or '') != planner_id:
        raise RuntimeError('Text-prune planner id does not match the source manifest.')
    prefix = str(manifest.get('prefix') or '').strip().rstrip('/')
    if not prefix:
        raise RuntimeError('Source manifest does not define a serving prefix.')

    base = f'{prefix}/text-prune-v{PRUNER_VERSION}/{planner_id}'
    candidate_key = f'{base}/candidate.json'
    ready_key = f'{base}/ready.json'

    if args.activate_only:
        candidate_body = get_bytes(candidate_key)
        candidate = orjson.loads(candidate_body)
        if (
            int(candidate.get('schema_version') or 0) != 1
            or int(candidate.get('pruner_version') or 0) != PRUNER_VERSION
            or str(candidate.get('source_manifest_key') or '') != manifest_key
            or str(candidate.get('source_manifest_sha256') or '') != manifest_sha
            or str(candidate.get('planner_id') or '') != planner_id
            or int(candidate.get('prefix_length') or 0) != PREFIX_LENGTH
            or str(candidate.get('signature_format') or '') != SIGNATURE_FORMAT
        ):
            raise RuntimeError('Text-prune candidate does not match the active manifest.')
        ready_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
        put_immutable(ready_key, ready_body, content_type='application/json', metadata={'pruner-version': str(PRUNER_VERSION)})
        print(f'text_prune_activated=true ready_key={ready_key} route_objects={candidate.get("route_object_count")}', flush=True)
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
    geo_records = sorted((record for record in records if isinstance(record, dict) and record.get('kind') == 'geo'), key=lambda record: str(record.get('key') or ''))
    route_records = sorted((record for record in records if isinstance(record, dict) and record.get('kind') == 'routing'), key=lambda record: str(record.get('key') or ''))
    if not geo_records or not route_records:
        raise RuntimeError('Source manifest must contain physical geo and routing objects.')

    projection_base = f'{prefix}/text-projection-v1/{planner_id}'

    def projection_core_key(source_key: str) -> str:
        return f'{projection_base}/core/{hashlib.sha256(source_key.encode()).hexdigest()}.json.zst'

    def route_sidecar_key(route_key: str) -> str:
        return f'{base}/routes/{hashlib.sha256(route_key.encode()).hexdigest()}.json.zst'

    def process_geo(record: dict):
        # zstd contexts hold mutable C state; sharing one across ThreadPoolExecutor
        # workers segfaults. Every worker creates its own instances.
        decompressor = zstd.ZstdDecompressor()
        source_key = str(record.get('key') or '')
        source_sha = str(record.get('sha256') or '').lower()
        expected_count = int(record.get('count') or 0)
        if not source_key or not source_sha or expected_count < 0:
            raise RuntimeError(f'Invalid physical geo record: {record!r}')

        core_body = get_optional_bytes(projection_core_key(source_key))
        if core_body is not None:
            payload = orjson.loads(decompressor.decompress(core_body))
            if not isinstance(payload, list) or len(payload) < 2 or int(payload[0]) != 1 or not isinstance(payload[1], list) or len(payload[1]) != expected_count:
                raise RuntimeError(f'Existing compact projection core is invalid: {source_key}')
            signature, max_quality, max_popularity, has_photo = signature_from_projection_rows(payload[1])
            reused_core = True
        else:
            body = get_bytes(source_key)
            if sha256_hex(body) != source_sha:
                raise RuntimeError(f'Physical geo checksum mismatch: {source_key}')
            documents = orjson.loads(brotli.decompress(body))
            if not isinstance(documents, list) or len(documents) != expected_count:
                raise RuntimeError(f'Physical geo row count mismatch: {source_key}')
            signature, max_quality, max_popularity, has_photo = signature_from_documents(documents)
            reused_core = False
        return source_key, [source_key, signature, max_quality, max_popularity, has_photo], reused_core

    signatures: dict[str, list] = {}
    reused_cores = 0
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process_geo, record) for record in geo_records]
        for future in as_completed(futures):
            source_key, signature, reused_core = future.result()
            signatures[source_key] = signature
            reused_cores += int(reused_core)
            completed += 1
            if completed % 100 == 0 or completed == len(geo_records):
                print(f'text_prune_signature_progress objects={completed}/{len(geo_records)} reused_projection_cores={reused_cores}', flush=True)

    sidecar_compressed_bytes = 0
    sidecar_raw_bytes = 0
    completed_routes = 0

    def process_route(record: dict) -> tuple[int, int]:
        compressor = zstd.ZstdCompressor(level=9)
        route_key = str(record.get('key') or '')
        route_sha = str(record.get('sha256') or '').lower()
        body = get_bytes(route_key)
        if sha256_hex(body) != route_sha:
            raise RuntimeError(f'Routing object checksum mismatch: {route_key}')
        descriptors = orjson.loads(brotli.decompress(body))
        if not isinstance(descriptors, list):
            raise RuntimeError(f'Routing object is not an array: {route_key}')
        pack_keys = sorted({str(descriptor[0]) for descriptor in descriptors if isinstance(descriptor, list) and descriptor and descriptor[0]})
        rows = []
        for pack_key in pack_keys:
            signature = signatures.get(pack_key)
            if signature is None:
                raise RuntimeError(f'Routing object references an unknown physical pack: {pack_key}')
            rows.append(signature)
        raw = orjson.dumps([PRUNER_VERSION, rows])
        compressed = compressor.compress(raw)
        put_immutable(
            route_sidecar_key(route_key),
            compressed,
            content_type='application/zstd',
            metadata={
                'pruner-version': str(PRUNER_VERSION),
                'source-route-sha256': route_sha,
                'pack-count': str(len(rows)),
                'uncompressed-bytes': str(len(raw)),
            },
        )
        return len(raw), len(compressed)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process_route, record) for record in route_records]
        for future in as_completed(futures):
            raw_bytes, compressed_bytes = future.result()
            sidecar_raw_bytes += raw_bytes
            sidecar_compressed_bytes += compressed_bytes
            completed_routes += 1
            if completed_routes % 100 == 0 or completed_routes == len(route_records):
                print(f'text_prune_route_progress objects={completed_routes}/{len(route_records)} compressed_bytes={sidecar_compressed_bytes}', flush=True)

    candidate = {
        'schema_version': 1,
        'pruner_version': PRUNER_VERSION,
        'source_manifest_key': manifest_key,
        'source_manifest_sha256': manifest_sha,
        'planner_id': planner_id,
        'snapshot': manifest.get('snapshot') or manifest.get('source_snapshot'),
        'prefix_length': PREFIX_LENGTH,
        'signature_format': SIGNATURE_FORMAT,
        'physical_pack_count': len(geo_records),
        'route_object_count': len(route_records),
        'reused_projection_cores': reused_cores,
        'sidecar_uncompressed_bytes': sidecar_raw_bytes,
        'sidecar_compressed_bytes': sidecar_compressed_bytes,
    }
    candidate_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
    s3.put_object(Bucket=source.bucket, Key=candidate_key, Body=candidate_body, ContentType='application/json', CacheControl='no-store')
    print(
        f'text_prune_complete=true candidate_key={candidate_key} physical_packs={len(geo_records)} routes={len(route_records)} '
        f'sidecar_compressed_bytes={sidecar_compressed_bytes} reused_projection_cores={reused_cores}',
        flush=True,
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(f'BUILDER_ERROR={type(error).__name__}: {error}', flush=True)
        raise
