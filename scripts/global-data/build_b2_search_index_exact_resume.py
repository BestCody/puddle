#!/usr/bin/env python3
"""Run the B2 search builder with deterministic, immutable resume semantics.

The immutable routing object itself is a durable progress marker. Matching objects are
reused without another PUT. Any existing final artifact whose byte length/SHA differs
from the deterministic body is treated as an immutable-key conflict instead of being
overwritten. Builder checkpoint deletion is deferred until the full migration gate has
passed.
"""
from __future__ import annotations

import os
import runpy
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import brotli
import orjson
from botocore.exceptions import ClientError


BUILDER_PATH = Path(__file__).with_name('build_b2_search_index.py')
ns = runpy.run_path(str(BUILDER_PATH), run_name='puddle_b2_search_builder')
ArtifactWriter = ns['ArtifactWriter']
CHECKPOINT_CONCURRENCY = int(ns['CHECKPOINT_CONCURRENCY'])
is_missing_object = ns['is_missing_object']
sha256_hex = ns['sha256_hex']
_original_put_bytes = ArtifactWriter.put_bytes
_original_delete_prefix = ns['delete_prefix']


def _append_existing_record(writer, record: dict) -> dict:
    writer.hashes_handle.write(orjson.dumps(record) + b'\n')
    writer.count += 1
    writer.compressed_bytes += int(record['compressed_bytes'])
    return record


def _record_for_body(
    writer,
    *,
    key: str,
    body: bytes,
    uncompressed_bytes: int,
    count: int | None,
    kind: str,
) -> dict:
    record = {
        'key': key,
        'sha256': sha256_hex(body),
        'compressed_bytes': len(body),
        'uncompressed_bytes': int(uncompressed_bytes),
        'kind': kind,
    }
    if count is not None:
        record['count'] = int(count)
    return record


def immutable_put_bytes(
    writer,
    relative: str,
    body: bytes,
    *,
    uncompressed_bytes: int,
    count: int | None,
    kind: str,
    content_type: str = 'application/json',
) -> dict:
    """Reuse exact existing artifacts and never overwrite a conflicting final key."""
    key = writer.key(relative)
    record = _record_for_body(
        writer,
        key=key,
        body=body,
        uncompressed_bytes=uncompressed_bytes,
        count=count,
        kind=kind,
    )
    try:
        head = writer.s3.head_object(Bucket=writer.bucket, Key=key)
    except ClientError as error:
        if is_missing_object(error):
            return _original_put_bytes(
                writer,
                relative,
                body,
                uncompressed_bytes=uncompressed_bytes,
                count=count,
                kind=kind,
                content_type=content_type,
            )
        raise

    actual_size = int(head.get('ContentLength', -1))
    actual_sha = str((head.get('Metadata') or {}).get('sha256', '')).lower()
    expected_size = int(record['compressed_bytes'])
    expected_sha = str(record['sha256']).lower()
    if (actual_size, actual_sha) != (expected_size, expected_sha):
        raise RuntimeError(
            'Immutable B2 artifact conflict for '
            f'{key}: existing size/sha=({actual_size},{actual_sha or "missing"}) '
            f'expected=({expected_size},{expected_sha}). '
            'Repair the candidate from an exact historical B2 version or use a new snapshot namespace.'
        )

    return _append_existing_record(writer, record)


def _deterministic_json(value, *, kind: str) -> bytes:
    # Geo-map lists contain canonical documents. Their order is already stable in the base
    # builder, but sorting here makes that guarantee explicit. Dict key ordering is also
    # normalized so ID/slug/count shards do not depend on DuckDB/spool insertion order.
    if isinstance(value, list) and value and all(isinstance(item, dict) and item.get('id') is not None for item in value):
        value = sorted(value, key=lambda item: str(item.get('id') or ''))
    return orjson.dumps(value, option=orjson.OPT_SORT_KEYS)


def deterministic_brotli_json(value, quality: int = 5) -> tuple[bytes, int]:
    """Deterministically serialize geo document lists before split-size decisions."""
    if isinstance(value, list) and value and all(isinstance(item, dict) and item.get('id') is not None for item in value):
        # Mutate the leaf/node list so a later size-triggered split sees the same order too.
        value.sort(key=lambda item: str(item.get('id') or ''))
    raw = orjson.dumps(value, option=orjson.OPT_SORT_KEYS)
    return brotli.compress(raw, quality=quality, mode=brotli.MODE_TEXT), len(raw)


def _routing_metadata(writer) -> dict[str, tuple[int, str]]:
    cached = getattr(writer, '_exact_resume_routing_metadata', None)
    if cached is not None:
        return cached

    prefix = f'{writer.prefix}/routing/'
    listed: list[tuple[str, int]] = []
    paginator = writer.s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=writer.bucket, Prefix=prefix):
        for item in page.get('Contents', []):
            key = str(item.get('Key') or '')
            if key:
                listed.append((key, int(item.get('Size') or 0)))

    if not listed:
        writer._exact_resume_routing_metadata = {}
        writer._exact_resume_reused = 0
        print('routing_exact_resume_candidates=0', flush=True)
        return writer._exact_resume_routing_metadata

    def head(entry: tuple[str, int]):
        key, listed_size = entry
        try:
            response = writer.s3.head_object(Bucket=writer.bucket, Key=key)
        except ClientError as error:
            if is_missing_object(error):
                return None
            raise
        metadata = response.get('Metadata') or {}
        return key, (int(response.get('ContentLength', listed_size)), str(metadata.get('sha256') or '').lower())

    verified: dict[str, tuple[int, str]] = {}
    completed = 0
    with ThreadPoolExecutor(max_workers=CHECKPOINT_CONCURRENCY) as executor:
        futures = [executor.submit(head, entry) for entry in listed]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                key, metadata = result
                verified[key] = metadata
            completed += 1
            if completed % 1000 == 0 or completed == len(listed):
                print(f'routing_exact_resume_probe verified={completed}/{len(listed)}', flush=True)

    writer._exact_resume_routing_metadata = verified
    writer._exact_resume_reused = 0
    print(f'routing_exact_resume_candidates={len(verified)}', flush=True)
    return verified


def deterministic_put_json(
    writer,
    relative: str,
    value,
    *,
    count: int | None,
    kind: str,
    quality: int = 5,
) -> dict:
    raw = _deterministic_json(value, kind=kind)
    body = brotli.compress(raw, quality=quality, mode=brotli.MODE_TEXT)
    key = writer.key(relative)
    digest = sha256_hex(body)

    if kind == 'routing' and '--no-resume' not in sys.argv:
        existing = _routing_metadata(writer).get(key)
        if existing == (len(body), digest):
            record = _record_for_body(
                writer,
                key=key,
                body=body,
                uncompressed_bytes=len(raw),
                count=count,
                kind=kind,
            )
            _append_existing_record(writer, record)
            writer._exact_resume_reused += 1
            reused = int(writer._exact_resume_reused)
            if reused % 250 == 0:
                print(f'routing_exact_resume_reused={reused}', flush=True)
            return record

    return writer.put_bytes(
        relative,
        body,
        uncompressed_bytes=len(raw),
        count=count,
        kind=kind,
    )


def deferred_delete_prefix(s3, bucket: str, prefix: str) -> int:
    """Keep checkpoints until a later post-smoke workflow step explicitly removes them."""
    if os.getenv('GLOBAL_LOCATION_ALLOW_BUILDER_CHECKPOINT_CLEANUP', '').strip() == '1':
        return _original_delete_prefix(s3, bucket, prefix)
    print(f'checkpoint_cleanup_deferred prefix={prefix}', flush=True)
    return 0


ArtifactWriter.put_bytes = immutable_put_bytes
ArtifactWriter.put_json = deterministic_put_json
ns['brotli_json'] = deterministic_brotli_json
ns['delete_prefix'] = deferred_delete_prefix
ns['main']()
