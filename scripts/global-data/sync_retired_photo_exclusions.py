#!/usr/bin/env python3
"""Publish retired relational B2 photo identities as a fixed B2 exclusion overlay."""
import hashlib
import json
import os
import tempfile
import urllib.parse
import urllib.request

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


SUPABASE_URL = first_env('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL').rstrip('/')
SUPABASE_KEY = first_env('SUPABASE_SECRET_KEY')
DATA_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
DATA_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
SNAPSHOT = str(os.getenv('GLOBAL_LOCATION_SNAPSHOT', '')).strip()

if not SUPABASE_URL or not SUPABASE_KEY or not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY or not SNAPSHOT:
    raise RuntimeError('Supabase, B2 data, and active snapshot configuration are required.')

data_s3 = boto3.client(
    's3', endpoint_url=DATA_ENDPOINT_URL, aws_access_key_id=DATA_KEY_ID,
    aws_secret_access_key=DATA_KEY, region_name=DATA_REGION,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)

url = f"{SUPABASE_URL}/rest/v1/rpc/{urllib.parse.quote('list_retired_b2_photo_exclusions_v1')}"
body = json.dumps({'p_limit': 100000}).encode()
headers = {
    'Accept': 'application/json', 'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
    'User-Agent': 'Puddle/1.0 retired photo exclusion sync',
}
with urllib.request.urlopen(urllib.request.Request(url, data=body, method='POST', headers=headers), timeout=60) as response:
    rows = json.loads(response.read() or b'[]')

con = duckdb.connect()
con.execute('CREATE TEMP TABLE retired_exclusions(location_id VARCHAR,content_hash VARCHAR,reason VARCHAR)')
if rows:
    con.executemany('INSERT INTO retired_exclusions VALUES (?,?,?)', [
        (str(row['location_id']), str(row['content_hash']).lower(), 'retired_relational_source') for row in rows
    ])
key = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={SNAPSHOT}/retired-relational.parquet'
with tempfile.NamedTemporaryFile(suffix='.parquet', delete=False) as handle:
    local_path = handle.name
changed = True
try:
    escaped = local_path.replace("'", "''")
    con.execute(f"COPY retired_exclusions TO '{escaped}' (FORMAT PARQUET,COMPRESSION ZSTD)")
    with open(local_path, 'rb') as handle:
        payload = handle.read()
    payload_sha256 = hashlib.sha256(payload).hexdigest()
    try:
        existing = data_s3.head_object(Bucket=DATA_BUCKET, Key=key)
        changed = not (
            int(existing.get('ContentLength', -1)) == len(payload)
            and existing.get('Metadata', {}).get('sha256') == payload_sha256
        )
    except Exception:
        changed = True
    if changed:
        data_s3.put_object(
            Bucket=DATA_BUCKET, Key=key, Body=payload,
            ContentType='application/vnd.apache.parquet',
            Metadata={
                'purpose': 'puddle_retired_photo_exclusions',
                'snapshot': SNAPSHOT,
                'sha256': payload_sha256,
            },
        )
finally:
    try:
        os.remove(local_path)
    except FileNotFoundError:
        pass
print(json.dumps({'retiredExclusions': len(rows), 'key': key, 'changed': changed}, indent=2))
