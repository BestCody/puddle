#!/usr/bin/env python3
"""Run one deterministic shard of global entity resolution, skipping completed countries."""
import argparse
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

import boto3
from botocore.client import Config


def first_env(*names, default=''):
    for name in names:
        value = str(os.getenv(name, '')).strip()
        if value:
            return value
    return default


def clean_prefix(value):
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--shard-index', type=int, required=True)
parser.add_argument('--shard-count', type=int, required=True)
parser.add_argument('--bootstrap-prefix', default=os.getenv('GLOBAL_BOOTSTRAP_B2_PREFIX', 'data/snapshots/bootstrap/current'))
args = parser.parse_args()
if args.shard_count < 1 or args.shard_index < 0 or args.shard_index >= args.shard_count:
    raise RuntimeError('Invalid shard index/count.')

endpoint = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
key_id = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
key = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
bucket = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
data_prefix = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not endpoint or not key_id or not key:
    raise RuntimeError('B2 endpoint and credentials are required.')

s3 = boto3.client(
    's3', endpoint_url=endpoint, aws_access_key_id=key_id, aws_secret_access_key=key,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)
staged_prefix = f'{data_prefix}/staged/places/schema=v1/snapshot={args.snapshot}/'
normalized_prefix = f'{data_prefix}/normalized/schema=v1/snapshot={args.snapshot}/'

expected = set()
for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=staged_prefix):
    for row in page.get('Contents', []):
        match = re.search(r'/country_code=([^/]+)/', row['Key'])
        if match:
            expected.add(match.group(1).upper())
if not expected:
    raise RuntimeError(f'No staged country partitions found under {staged_prefix}')

locations = set()
crosswalk = set()
aliases = set()
for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=normalized_prefix):
    for row in page.get('Contents', []):
        match = re.search(r'/country_code=([^/]+)/(locations|source_crosswalk|location_aliases)\.parquet$', row['Key'])
        if not match:
            continue
        country, kind = match.groups()
        country = country.upper()
        if kind == 'locations':
            locations.add(country)
        elif kind == 'source_crosswalk':
            crosswalk.add(country)
        else:
            aliases.add(country)
complete = locations & crosswalk & aliases

assigned = sorted(expected)[args.shard_index::args.shard_count]
pending = [country for country in assigned if country not in complete]
print(f'shard={args.shard_index}/{args.shard_count} assigned={len(assigned)} already_complete={len(assigned)-len(pending)} pending={len(pending)}')
if not pending:
    print('nothing to resolve for this shard')
    raise SystemExit(0)

command = [
    sys.executable,
    'scripts/global-data/resolve_global_entities.py',
    f'--snapshot={args.snapshot}',
    f'--bootstrap-prefix={args.bootstrap_prefix}',
    '--countries=' + ','.join(pending),
]
print('resolving countries: ' + ','.join(pending))
subprocess.run(command, check=True)
