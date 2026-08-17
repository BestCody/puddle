#!/usr/bin/env python3
"""Validate all resolved country partitions and publish the canonical snapshot manifest."""
import argparse
import json
import os
import re
from datetime import datetime, timezone

import boto3
import duckdb
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
args = parser.parse_args()

endpoint_url = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
endpoint = endpoint_url.replace('https://', '').replace('http://', '')
key_id = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
key = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
bucket = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
region = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
data_prefix = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not endpoint_url or not key_id or not key:
    raise RuntimeError('B2 endpoint and credentials are required.')

s3 = boto3.client(
    's3', endpoint_url=endpoint_url, aws_access_key_id=key_id, aws_secret_access_key=key,
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

parts = {'locations': set(), 'source_crosswalk': set(), 'location_aliases': set()}
for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=normalized_prefix):
    for row in page.get('Contents', []):
        match = re.search(r'/country_code=([^/]+)/(locations|source_crosswalk|location_aliases)\.parquet$', row['Key'])
        if match:
            country, kind = match.groups()
            parts[kind].add(country.upper())
complete = parts['locations'] & parts['source_crosswalk'] & parts['location_aliases']
missing = sorted(expected - complete)
if missing:
    raise RuntimeError(f'Canonical snapshot is incomplete: {len(missing)} country partitions missing: {",".join(missing[:40])}')

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(32, int(os.getenv('GLOBAL_FINALIZE_THREADS', '8'))))}")
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3,
 KEY_ID '{key_id.replace("'", "''")}',
 SECRET '{key.replace("'", "''")}',
 REGION '{region.replace("'", "''")}',
 ENDPOINT '{endpoint.replace("'", "''")}',
 URL_STYLE 'path',
 USE_SSL true
);
""")
root = f's3://{bucket}/{normalized_prefix.rstrip("/")}'
locations_glob = root + '/country_code=*/locations.parquet'
crosswalk_glob = root + '/country_code=*/source_crosswalk.parquet'
alias_glob = root + '/country_code=*/location_aliases.parquet'

location_total, unique_ids = con.execute(
    f"SELECT count(*), count(DISTINCT cast(id AS VARCHAR)) FROM read_parquet('{locations_glob}', union_by_name=true)"
).fetchone()
if location_total <= 0:
    raise RuntimeError('Canonical snapshot contains no locations.')
if location_total != unique_ids:
    duplicate_count = location_total - unique_ids
    raise RuntimeError(f'Canonical location IDs are not globally unique: {duplicate_count} duplicate rows detected.')

source_links, unique_source_links = con.execute(
    f"SELECT count(*), count(DISTINCT cast(source AS VARCHAR) || ':' || cast(source_id AS VARCHAR)) FROM read_parquet('{crosswalk_glob}', union_by_name=true)"
).fetchone()
if source_links != unique_source_links:
    raise RuntimeError(f'Source crosswalk keys are not globally unique: rows={source_links}, unique={unique_source_links}.')
aliases = con.execute(f"SELECT count(*) FROM read_parquet('{alias_glob}', union_by_name=true)").fetchone()[0]

location_rows = dict(con.execute(f"""
SELECT regexp_extract(filename, 'country_code=([^/]+)', 1) country_code, count(*)
FROM read_parquet('{locations_glob}', union_by_name=true, filename=true)
GROUP BY 1 ORDER BY 1
""").fetchall())
link_rows = dict(con.execute(f"""
SELECT regexp_extract(filename, 'country_code=([^/]+)', 1) country_code, count(*)
FROM read_parquet('{crosswalk_glob}', union_by_name=true, filename=true)
GROUP BY 1 ORDER BY 1
""").fetchall())
alias_rows = dict(con.execute(f"""
SELECT regexp_extract(filename, 'country_code=([^/]+)', 1) country_code, count(*)
FROM read_parquet('{alias_glob}', union_by_name=true, filename=true)
GROUP BY 1 ORDER BY 1
""").fetchall())

countries = []
for country in sorted(expected):
    countries.append({
        'countryCode': country,
        'locations': int(location_rows.get(country, 0)),
        'sourceLinks': int(link_rows.get(country, 0)),
        'aliases': int(alias_rows.get(country, 0)),
    })
summary = {
    'snapshot': args.snapshot,
    'resolvedAt': datetime.now(timezone.utc).isoformat(),
    'countries': countries,
    'countryPartitions': len(countries),
    'locationRows': int(location_total),
    'uniqueLocationIds': int(unique_ids),
    'sourceLinks': int(source_links),
    'uniqueSourceLinks': int(unique_source_links),
    'aliases': int(aliases),
    'validation': {
        'allStagedCountriesResolved': True,
        'globalLocationIdsUnique': True,
        'globalSourceKeysUnique': True,
    },
}
manifest_key = f'{normalized_prefix}manifest.json'
s3.put_object(Bucket=bucket, Key=manifest_key, Body=(json.dumps(summary, indent=2) + '\n').encode(), ContentType='application/json')
print(json.dumps(summary, indent=2))
