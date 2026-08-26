#!/usr/bin/env python3
"""Carry canonical photo metadata and exclusions into a new data snapshot.

Photo materialization intentionally runs against the active snapshot so provider
workers can share one stable location catalogue. The next immutable location
snapshot must carry that canonical state forward before its search index is
built; otherwise a successful location rebuild would silently hide every photo
until the next enrichment cycle.
"""
from __future__ import annotations

import argparse
import os
import re
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.client import Config


SNAPSHOT_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def clean_prefix(value: object) -> str:
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


def snapshot_argument(value: str) -> str:
    value = str(value or '').strip()
    if not SNAPSHOT_RE.fullmatch(value):
        raise argparse.ArgumentTypeError('snapshot must be an ISO date (YYYY-MM-DD)')
    return value


parser = argparse.ArgumentParser()
parser.add_argument('--source-snapshot', required=True, type=snapshot_argument)
parser.add_argument('--target-snapshot', required=True, type=snapshot_argument)
args = parser.parse_args()

BUCKET = os.getenv('B2_DATA_BUCKET_NAME', '').strip()
ENDPOINT = os.getenv('B2_DATA_S3_ENDPOINT', '').strip()
KEY_ID = os.getenv('B2_DATA_APPLICATION_KEY_ID', '').strip()
KEY = os.getenv('B2_DATA_APPLICATION_KEY', '').strip()
REGION = os.getenv('B2_DATA_S3_REGION', 'us-east-005').strip()
DATA_PREFIX = clean_prefix(os.getenv('B2_DATA_PREFIX', 'data'))
COPY_CONCURRENCY = max(1, min(64, int(os.getenv('GLOBAL_PHOTO_CARRY_CONCURRENCY', '16'))))

if not BUCKET or not ENDPOINT or not KEY_ID or not KEY:
    raise RuntimeError('B2 data endpoint and credentials are required.')

client = boto3.client(
    's3',
    endpoint_url=ENDPOINT,
    aws_access_key_id=KEY_ID,
    aws_secret_access_key=KEY,
    region_name=REGION,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=COPY_CONCURRENCY * 2),
)


def copy_parquet_prefix(name: str) -> int:
    source_prefix = f'{DATA_PREFIX}/enrichment/{name}/snapshot={args.source_snapshot}'
    target_prefix = f'{DATA_PREFIX}/enrichment/{name}/snapshot={args.target_snapshot}'
    paginator = client.get_paginator('list_objects_v2')
    copies: list[tuple[str, str]] = []
    source_root = source_prefix.rstrip('/') + '/'

    for page in paginator.paginate(Bucket=BUCKET, Prefix=source_root):
        for item in page.get('Contents', []):
            source_key = str(item.get('Key') or '')
            if not source_key.startswith(source_root) or not source_key.endswith('.parquet'):
                continue
            relative = source_key[len(source_root):]
            if relative:
                copies.append((source_key, f'{target_prefix}/{relative}'))

    if not copies:
        print(f'{name}: no source parquet objects under {source_root}', flush=True)
        return 0

    def copy_one(pair: tuple[str, str]) -> None:
        source_key, target_key = pair
        client.copy_object(
            Bucket=BUCKET,
            Key=target_key,
            CopySource={'Bucket': BUCKET, 'Key': source_key},
            MetadataDirective='COPY',
        )

    with ThreadPoolExecutor(max_workers=COPY_CONCURRENCY) as executor:
        list(executor.map(copy_one, copies))

    print(f'{name}: carried {len(copies)} parquet objects into {target_prefix}', flush=True)
    return len(copies)


if args.source_snapshot == args.target_snapshot:
    print('photo enrichment already targets the requested snapshot; nothing to carry', flush=True)
else:
    counts = {
        'photo_metadata': copy_parquet_prefix('photo_metadata'),
        'photo_exclusions': copy_parquet_prefix('photo_exclusions'),
    }
    print(
        f"photo enrichment carry complete: source={args.source_snapshot} "
        f"target={args.target_snapshot} objects={sum(counts.values())}",
        flush=True,
    )
