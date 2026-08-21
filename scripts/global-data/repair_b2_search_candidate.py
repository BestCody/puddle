#!/usr/bin/env python3
"""Repair an immutable B2 search candidate from exact historical object versions.

This never weakens validation. It loads the candidate hash ledger, HEAD-checks every
artifact, and for each missing/conflicting current object searches B2's retained object
versions for a body whose exact compressed byte length and SHA-256 match the ledger.
With --apply, only an exact matching historical body is restored to the current key.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import brotli
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get('Error', {}).get('Code') or '')
    status = int(error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') or 0)
    return code in {'404', 'NoSuchKey', 'NotFound'} or status == 404


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--apply', action='store_true', help='Restore exact ledger-matching historical versions.')
    parser.add_argument('--head-workers', type=int, default=int(os.getenv('GLOBAL_LOCATION_VALIDATE_HEAD_WORKERS', '16')))
    args = parser.parse_args()

    source = b2_source_config()
    prefix = f'{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}'
    manifest_key = f'{prefix}/manifest.json'
    s3 = boto3.client(
        's3',
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(
            retries={'max_attempts': 10, 'mode': 'adaptive'},
            max_pool_connections=max(16, min(32, int(args.head_workers))),
        ),
    )

    def get_bytes(key: str, *, version_id: str | None = None) -> bytes:
        kwargs = {'Bucket': source.bucket, 'Key': key}
        if version_id:
            kwargs['VersionId'] = version_id
        return s3.get_object(**kwargs)['Body'].read()

    manifest_body = get_bytes(manifest_key)
    manifest = json.loads(manifest_body)
    if int(manifest.get('schema_version', 0)) != 1 or str(manifest.get('snapshot')) != args.snapshot:
        raise RuntimeError('Candidate manifest does not match requested schema/snapshot.')

    validation = manifest.get('validation') or {}
    hashes_key = str(validation.get('hashes_key') or '')
    expected_hashes_sha = str(validation.get('hashes_sha256') or '').lower()
    hashes_body = get_bytes(hashes_key)
    if sha256_hex(hashes_body) != expected_hashes_sha:
        raise RuntimeError('Candidate hash ledger checksum does not match manifest.')
    records = json.loads(brotli.decompress(hashes_body))
    if len(records) != int(validation.get('artifact_count', -1)) or not records:
        raise RuntimeError('Candidate hash ledger artifact count does not match manifest.')

    def inspect(record: dict) -> dict | None:
        key = str(record['key'])
        expected_size = int(record['compressed_bytes'])
        expected_sha = str(record['sha256']).lower()
        try:
            head = s3.head_object(Bucket=source.bucket, Key=key)
        except ClientError as error:
            if is_missing(error):
                return {'record': record, 'reason': 'missing', 'actual_size': None, 'actual_sha': None}
            raise
        actual_size = int(head.get('ContentLength', -1))
        actual_sha = str((head.get('Metadata') or {}).get('sha256', '')).lower()
        if (actual_size, actual_sha) == (expected_size, expected_sha):
            return None
        return {'record': record, 'reason': 'mismatch', 'actual_size': actual_size, 'actual_sha': actual_sha}

    mismatches: list[dict] = []
    workers = max(1, min(32, int(args.head_workers)))
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(inspect, record) for record in records]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                mismatches.append(result)
            completed += 1
            if completed % 1000 == 0 or completed == len(records):
                print(f'repair_head_checked={completed}/{len(records)} mismatches={len(mismatches)}', flush=True)

    mismatches.sort(key=lambda item: str(item['record']['key']))
    if not mismatches:
        print('repair_mismatches=0', flush=True)
        return

    print(f'repair_mismatches={len(mismatches)}', flush=True)
    for item in mismatches:
        record = item['record']
        print(
            'repair_mismatch '
            f"key={record['key']} reason={item['reason']} "
            f"expected_size={record['compressed_bytes']} expected_sha={record['sha256']} "
            f"actual_size={item['actual_size']} actual_sha={item['actual_sha'] or 'missing'}",
            flush=True,
        )

    if not args.apply:
        raise RuntimeError('Candidate has mismatched artifacts; rerun with --apply to restore exact historical versions.')

    repaired = 0
    for item in mismatches:
        record = item['record']
        key = str(record['key'])
        expected_size = int(record['compressed_bytes'])
        expected_sha = str(record['sha256']).lower()
        matching_body: bytes | None = None
        matching_version: str | None = None
        matching_content_type = 'application/json'

        paginator = s3.get_paginator('list_object_versions')
        for page in paginator.paginate(Bucket=source.bucket, Prefix=key):
            for version in page.get('Versions', []):
                if str(version.get('Key') or '') != key or int(version.get('Size') or -1) != expected_size:
                    continue
                version_id = str(version.get('VersionId') or '')
                if not version_id:
                    continue
                response = s3.get_object(Bucket=source.bucket, Key=key, VersionId=version_id)
                body = response['Body'].read()
                if len(body) != expected_size or sha256_hex(body) != expected_sha:
                    continue
                matching_body = body
                matching_version = version_id
                matching_content_type = str(response.get('ContentType') or 'application/json')
                break
            if matching_body is not None:
                break

        if matching_body is None:
            raise RuntimeError(
                f'No historical B2 version exactly matches ledger size/SHA for {key}; refusing to synthesize or relax validation.'
            )

        s3.put_object(
            Bucket=source.bucket,
            Key=key,
            Body=matching_body,
            ContentType=matching_content_type,
            CacheControl='public,max-age=31536000,immutable',
            Metadata={'sha256': expected_sha},
        )
        head = s3.head_object(Bucket=source.bucket, Key=key)
        actual_size = int(head.get('ContentLength', -1))
        actual_sha = str((head.get('Metadata') or {}).get('sha256', '')).lower()
        if (actual_size, actual_sha) != (expected_size, expected_sha):
            raise RuntimeError(f'Restored object did not verify after PUT: {key}')
        repaired += 1
        print(f'repair_restored={repaired}/{len(mismatches)} key={key} source_version={matching_version}', flush=True)

    print(f'repair_complete={repaired}', flush=True)


if __name__ == '__main__':
    main()
