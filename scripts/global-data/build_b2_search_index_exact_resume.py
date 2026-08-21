#!/usr/bin/env python3
"""Run the B2 search builder with exact per-routing-object resume semantics.

The immutable routing object itself is the durable progress marker. On retry, already
uploaded routing objects are HEAD-verified against the deterministic body produced from
the restored route-spool checkpoint. Matching objects are re-added to the local hash
ledger without another B2 PUT, so routing resumes at the first object that was not
successfully committed by the prior process.
"""
from __future__ import annotations

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
_original_put_json = ArtifactWriter.put_json


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
        return key, (int(response.get('ContentLength', listed_size)), str(metadata.get('sha256') or ''))

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
                print(
                    f'routing_exact_resume_probe verified={completed}/{len(listed)}',
                    flush=True,
                )

    writer._exact_resume_routing_metadata = verified
    writer._exact_resume_reused = 0
    print(f'routing_exact_resume_candidates={len(verified)}', flush=True)
    return verified


def _append_existing_record(writer, record: dict) -> dict:
    writer.hashes_handle.write(orjson.dumps(record) + b'\n')
    writer.count += 1
    writer.compressed_bytes += int(record['compressed_bytes'])
    return record


def exact_resume_put_json(writer, relative: str, value, *, count: int | None, kind: str, quality: int = 5) -> dict:
    if kind != 'routing' or '--no-resume' in sys.argv:
        return _original_put_json(writer, relative, value, count=count, kind=kind, quality=quality)

    raw = orjson.dumps(value)
    body = brotli.compress(raw, quality=quality, mode=brotli.MODE_TEXT)
    key = writer.key(relative)
    digest = sha256_hex(body)
    existing = _routing_metadata(writer).get(key)

    if existing == (len(body), digest):
        record = {
            'key': key,
            'sha256': digest,
            'compressed_bytes': len(body),
            'uncompressed_bytes': len(raw),
            'kind': kind,
        }
        if count is not None:
            record['count'] = int(count)
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


ArtifactWriter.put_json = exact_resume_put_json
ns['main']()
