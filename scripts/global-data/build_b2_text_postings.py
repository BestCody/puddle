#!/usr/bin/env python3
"""Build per-pack token-prefix postings for dense B2 text search.

Serving-only derivative of the already-built compact text projection cores; the
canonical/base index is never touched. For every physical pack the builder emits
one immutable postings object mapping three-character ASCII token prefixes to
row indexes inside that pack's projection core. Row order is identical to the
core payload, so hydrated winners line up with existing detail chunks.

At query time the runtime intersects the query tokens' prefixes across these
lists, scores only the surviving rows with the production scorer, and proves
top-K completeness against the same conservative per-pack maxima the text
pruner publishes before trusting the fast path. Candidate publication and
production activation remain separate so OpenSearch parity can gate readiness.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import random
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import brotli
import orjson
import zstandard as zstd
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config

POSTINGS_VERSION = 2
PREFIX_LENGTH = 3
ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
ALPHABET_INDEX = {char: index for index, char in enumerate(ALPHABET)}
DEFAULT_WORKERS = 16


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get('Error', {}).get('Code') or '')
    status = int(error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') or 0)
    return code in {'404', 'NoSuchKey', 'NotFound'} or status == 404


TRANSIENT_CODES = {'500', '502', '503', '504', 'SlowDown', 'InternalError', 'RequestTimeout', 'ThrottlingException'}


def is_transient(error: BaseException) -> bool:
    if isinstance(error, ClientError):
        code = str(error.response.get('Error', {}).get('Code') or '')
        status = str(error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') or '')
        return code in TRANSIENT_CODES or status in TRANSIENT_CODES
    return isinstance(error, (ConnectionError, TimeoutError))


def retry_s3(action, attempts: int = 8):
    delay = 0.5
    for attempt in range(attempts):
        try:
            return action()
        except BaseException as error:
            if attempt == attempts - 1 or not is_transient(error):
                raise
            time.sleep(delay + random.random() * delay)
            delay = min(10.0, delay * 2)


# Mirrors unicodedata-based ASCII folding used by the text-pruner signatures so
# rows whose normalized projection fields are null (non-ASCII source text) are
# still reachable through their folded prefixes. NFKD decomposition plus mark
# stripping turns e.g. 'café' into 'cafe', which is exactly the superset the
# runtime scorer's startsWith semantics require for pure-ASCII queries.
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


# Mirrors TEXT_CORE_INDEX in lib/app/b2-text-search-projection.js.
IDX_NAME = 1
IDX_ALIASES = 2
IDX_CATEGORY = 3
IDX_CITY = 6
IDX_NEIGHBORHOOD = 7
IDX_ADDRESS = 8
IDX_STATUS = 15
IDX_NORM_NAME = 16
IDX_NORM_ALIASES = 17
IDX_NORM_CATEGORY = 18
IDX_NORM_CITY = 19
IDX_NORM_NEIGHBORHOOD = 20
IDX_NORM_ADDRESS = 21


def pack_postings(rows: list) -> list:
    by_prefix: dict[int, list[int]] = {}

    def add_text(seen: set[int], text: str | None) -> None:
        if not text:
            return
        for token in text.split(' '):
            index = prefix_index(token)
            if index is not None:
                seen.add(index)

    for row_index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) < 22 or str(row[IDX_STATUS] or '') != 'published':
            continue
        seen: set[int] = set()
        pairs = (
            (row[IDX_NORM_NAME], row[IDX_NAME]),
            (row[IDX_NORM_CATEGORY], row[IDX_CATEGORY]),
            (row[IDX_NORM_CITY], row[IDX_CITY]),
            (row[IDX_NORM_NEIGHBORHOOD], row[IDX_NEIGHBORHOOD]),
            (row[IDX_NORM_ADDRESS], row[IDX_ADDRESS]),
        )
        for normalized, raw in pairs:
            add_text(seen, normalized if normalized is not None else ' '.join(normalized_tokens(raw)))
        aliases_raw = row[IDX_ALIASES] if isinstance(row[IDX_ALIASES], list) else []
        aliases_norm = row[IDX_NORM_ALIASES] if isinstance(row[IDX_NORM_ALIASES], list) else []
        for alias_index, alias in enumerate(aliases_raw):
            normalized_alias = aliases_norm[alias_index] if alias_index < len(aliases_norm) else None
            add_text(seen, normalized_alias if normalized_alias is not None else ' '.join(normalized_tokens(alias)))
        for index in seen:
            bucket = by_prefix.get(index)
            if bucket is None:
                by_prefix[index] = [row_index]
            else:
                bucket.append(row_index)
    entries = [[code, by_prefix[code]] for code in sorted(by_prefix)]
    return [POSTINGS_VERSION, entries]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-key', required=True)
    parser.add_argument('--planner-id', required=True)
    parser.add_argument('--workers', type=int, default=int(os.getenv('GLOBAL_LOCATION_POSTINGS_WORKERS', str(DEFAULT_WORKERS))))
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
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(32, workers * 2)),
    )

    def get_bytes(key: str) -> bytes:
        return retry_s3(lambda: s3.get_object(Bucket=source.bucket, Key=key)['Body'].read())

    def get_optional_bytes(key: str) -> bytes | None:
        try:
            return get_bytes(key)
        except ClientError as error:
            if is_missing(error):
                return None
            raise

    def head_object(key: str):
        return retry_s3(lambda: s3.head_object(Bucket=source.bucket, Key=key))

    def put_immutable(key: str, body: bytes, metadata: dict[str, str]) -> None:
        digest = sha256_hex(body)
        expected_metadata = {**metadata, 'sha256': digest}
        try:
            head = head_object(key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            actual_metadata = {str(k).lower(): str(v) for k, v in (head.get('Metadata') or {}).items()}
            if int(head.get('ContentLength') or -1) != len(body) or any(actual_metadata.get(k.lower()) != str(v) for k, v in expected_metadata.items()):
                raise RuntimeError(f'Immutable text-postings artifact differs: {key}')
            return
        retry_s3(lambda: s3.put_object(
            Bucket=source.bucket,
            Key=key,
            Body=body,
            ContentType='application/zstd',
            CacheControl='public,max-age=31536000,immutable',
            Metadata=expected_metadata,
        ))

    manifest_body = get_bytes(manifest_key)
    manifest_sha = sha256_hex(manifest_body)
    manifest = orjson.loads(manifest_body)
    if int(manifest.get('schema_version') or 0) != 1:
        raise RuntimeError('Text postings require B2 search schema version 1.')
    if str((manifest.get('planner') or {}).get('id') or '') != planner_id:
        raise RuntimeError('Text postings planner id does not match the source manifest.')
    prefix = str(manifest.get('prefix') or '').strip().rstrip('/')
    if not prefix:
        raise RuntimeError('Source manifest does not define a serving prefix.')

    projection_base = f'{prefix}/text-projection-v1/{planner_id}'
    base = f'{prefix}/text-postings-v{POSTINGS_VERSION}/{planner_id}'
    candidate_key = f'{base}/candidate.json'
    ready_key = f'{base}/ready.json'

    if args.activate_only:
        candidate_body = get_bytes(candidate_key)
        candidate = orjson.loads(candidate_body)
        if (
            int(candidate.get('schema_version') or 0) != 1
            or int(candidate.get('postings_version') or 0) != POSTINGS_VERSION
            or str(candidate.get('source_manifest_key') or '') != manifest_key
            or str(candidate.get('source_manifest_sha256') or '') != manifest_sha
            or str(candidate.get('planner_id') or '') != planner_id
            or int(candidate.get('prefix_length') or 0) != PREFIX_LENGTH
            or int(candidate.get('detail_chunk_size') or 0) < 64
            or int(candidate.get('physical_pack_count') or 0) <= 0
        ):
            raise RuntimeError('Text postings candidate does not match the requested active manifest.')
        ready_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
        digest = sha256_hex(ready_body)
        try:
            head = head_object(ready_key)
        except ClientError as error:
            if not is_missing(error):
                raise
            retry_s3(lambda: s3.put_object(
                Bucket=source.bucket,
                Key=ready_key,
                Body=ready_body,
                ContentType='application/json',
                CacheControl='public,max-age=31536000,immutable',
                Metadata={'sha256': digest},
            ))
        else:
            existing = get_bytes(ready_key)
            if existing != ready_body or str((head.get('Metadata') or {}).get('sha256') or '').lower() != digest:
                raise RuntimeError(f'Immutable text-postings ready marker differs: {ready_key}')
        print(f'text_postings_activated=true ready_key={ready_key} tiles={candidate.get("route_object_count")}', flush=True)
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

    def digest_for(source_key: str) -> str:
        return hashlib.sha256(source_key.encode()).hexdigest()

    def core_key(source_key: str) -> str:
        return f'{projection_base}/core/{digest_for(source_key)}.json.zst'

    thread_local = {}

    def context_for_thread():
        # zstd contexts hold mutable C state; one pair per worker thread.
        ident = threading.get_ident()
        value = thread_local.get(ident)
        if value is None:
            value = (zstd.ZstdDecompressor(), zstd.ZstdCompressor(level=9))
            thread_local[ident] = value
        return value

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
    route_records = sorted(
        (record for record in records if isinstance(record, dict) and record.get('kind') == 'routing'),
        key=lambda record: str(record.get('key') or ''),
    )
    if not route_records:
        raise RuntimeError('Source manifest contains no routing objects.')

    def core_key(source_key: str) -> str:
        return f'{projection_base}/core/{digest_for(source_key)}.json.zst'

    def tile_key(route_key: str) -> str:
        return f'{base}/tiles/{digest_for(route_key)}.json.zst'

    # Per-pack compressed postings, computed exactly once and reused for every
    # routing tile that contains the pack. Compressed bytes keep resident memory
    # around half a GiB for the full catalogue.
    pack_postings_bytes: dict[str, bytes] = {}
    pack_counts: dict[str, int] = {}
    pack_lock = threading.Lock()

    def pack_postings_payload(source_key: str, expected_count: int, decompressor, compressor) -> bytes:
        with pack_lock:
            cached = pack_postings_bytes.get(source_key)
        if cached is not None:
            return cached
        core_body = get_optional_bytes(core_key(source_key))
        if core_body is None:
            # Postings depend on projection cores; the projection candidate gate
            # guarantees existence, so a missing core here is a hard error.
            raise RuntimeError(f'Projection core missing for postings build: {source_key}')
        payload = orjson.loads(decompressor.decompress(core_body))
        if not isinstance(payload, list) or len(payload) < 2 or int(payload[0]) != 1 or not isinstance(payload[1], list):
            raise RuntimeError(f'Invalid compact projection core: {source_key}')
        if len(payload[1]) != expected_count:
            raise RuntimeError(f'Projection core row count mismatch: {source_key}')
        postings = pack_postings(payload[1])
        compressed = compressor.compress(orjson.dumps(postings))
        with pack_lock:
            existing = pack_postings_bytes.get(source_key)
            if existing is None:
                pack_postings_bytes[source_key] = compressed
                pack_counts[source_key] = expected_count
                existing = compressed
            else:
                expected_count = pack_counts[source_key]
        return existing

    def process_route_tile(record: dict) -> dict:
        decompressor, compressor = context_for_thread()
        route_key = str(record.get('key') or '')
        route_sha = str(record.get('sha256') or '').lower()
        if not route_key or not route_sha:
            raise RuntimeError(f'Invalid routing record: {record!r}')
        target_key = tile_key(route_key)

        try:
            head = head_object(target_key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            metadata = head.get('Metadata') or {}
            if str(metadata.get('route-sha256') or '') != route_sha:
                raise RuntimeError(f'Existing immutable text-postings tile differs: {target_key}')
            return {
                'bytes': int(head.get('ContentLength') or 0),
                'reused': 1,
                'members': int(metadata.get('pack-count') or 0),
            }

        body = get_bytes(route_key)
        if sha256_hex(body) != route_sha:
            raise RuntimeError(f'Routing object checksum mismatch: {route_key}')
        descriptors = orjson.loads(brotli.decompress(body))
        if not isinstance(descriptors, list):
            raise RuntimeError(f'Routing object is not an array: {route_key}')
        member_keys = sorted({str(descriptor[0]) for descriptor in descriptors if isinstance(descriptor, list) and descriptor and descriptor[0]})
        counts_by_key = {str(r.get('key') or ''): int(r.get('count') or 0) for r in geo_records}

        packs_payload = []
        total_members = 0
        for member_key in member_keys:
            expected_count = counts_by_key.get(member_key)
            if expected_count is None:
                raise RuntimeError(f'Routing object references an unknown physical pack: {member_key}')
            compressed = pack_postings_payload(member_key, expected_count, decompressor, compressor)
            entries = orjson.loads(decompressor.decompress(compressed))
            if not isinstance(entries, list) or len(entries) < 2 or int(entries[0]) != POSTINGS_VERSION:
                raise RuntimeError(f'Cached postings payload is invalid: {member_key}')
            packs_payload.append([member_key, entries[1]])
            total_members += 1

        raw = orjson.dumps([POSTINGS_VERSION, packs_payload])
        compressed_tile = compressor.compress(raw)
        put_immutable(target_key, compressed_tile, {
            'route-sha256': route_sha,
            'pack-count': str(total_members),
        })
        return {'bytes': len(compressed_tile), 'reused': 0, 'members': total_members}

    # Detail chunks live in the projection derivative; postings row order mirrors
    # the core payload, so hydration needs the projection's chunk size.
    projection_candidate_body = get_optional_bytes(f'{projection_base}/candidate.json')
    if projection_candidate_body is None:
        raise RuntimeError('Projection candidate must be built before text postings.')
    projection_candidate = orjson.loads(projection_candidate_body)
    detail_chunk_size = int(projection_candidate.get('detail_chunk_size') or 0)
    if detail_chunk_size < 64:
        raise RuntimeError('Projection candidate does not carry a valid detail_chunk_size.')

    total_bytes = 0
    reused = 0
    completed = 0
    total_members = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(process_route_tile, record) for record in route_records]
        for future in as_completed(futures):
            result = future.result()
            total_bytes += int(result['bytes'])
            reused += int(result['reused'])
            total_members += int(result['members'])
            completed += 1
            if completed % 500 == 0 or completed == len(route_records):
                print(
                    f'text_postings_progress tiles={completed}/{len(route_records)} '
                    f"bytes={total_bytes} reused={reused} members={total_members}",
                    flush=True,
                )

    # Coverage invariant: every routing tile was processed (built now or reused
    # from an identical prior build via route-sha256). Tile creation validates
    # each member against geo_records, so reuse transitively preserves coverage;
    # per-pack cache size only reflects packs this run had to compute fresh.
    if completed != len(route_records):
        raise RuntimeError(
            f'Text postings processed {completed} of {len(route_records)} routing tiles.'
        )
    if total_members <= 0 and route_records:
        raise RuntimeError('Text postings tiles reported no physical pack members.')

    candidate = {
        'schema_version': 1,
        'postings_version': POSTINGS_VERSION,
        'source_manifest_key': manifest_key,
        'source_manifest_sha256': manifest_sha,
        'planner_id': planner_id,
        'snapshot': manifest.get('snapshot') or manifest.get('source_snapshot'),
        'prefix_length': PREFIX_LENGTH,
        'detail_chunk_size': detail_chunk_size,
        'layout': 'routing-tile-bundles',
        'route_object_count': len(route_records),
        'physical_pack_count': len(geo_records),
        'tile_compressed_bytes': total_bytes,
        'reused_tiles': reused,
    }
    candidate_body = orjson.dumps(candidate, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b'\n'
    retry_s3(lambda: s3.put_object(Bucket=source.bucket, Key=candidate_key, Body=candidate_body, ContentType='application/json', CacheControl='no-store'))
    print(
        f'text_postings_complete=true candidate_key={candidate_key} tiles={len(route_records)} packs={len(geo_records)} bytes={total_bytes}',
        flush=True,
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(f'BUILDER_ERROR={type(error).__name__}: {error}', flush=True)
        raise
