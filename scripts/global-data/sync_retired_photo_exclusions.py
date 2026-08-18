#!/usr/bin/env python3
"""Publish retired relational B2 photo identities as a fixed B2 exclusion overlay."""
import json
import os
import urllib.parse
import urllib.request

import duckdb


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
DATA_ENDPOINT = DATA_ENDPOINT_URL.replace('https://', '').replace('http://', '')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
SNAPSHOT = str(os.getenv('GLOBAL_LOCATION_SNAPSHOT', '')).strip()

if not SUPABASE_URL or not SUPABASE_KEY or not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY or not SNAPSHOT:
    raise RuntimeError('Supabase, B2 data, and active snapshot configuration are required.')

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
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")
con.execute('CREATE TEMP TABLE retired_exclusions(location_id VARCHAR,content_hash VARCHAR,reason VARCHAR)')
if rows:
    con.executemany('INSERT INTO retired_exclusions VALUES (?,?,?)', [
        (str(row['location_id']), str(row['content_hash']).lower(), 'retired_relational_source') for row in rows
    ])
key = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={SNAPSHOT}/retired-relational.parquet'
con.execute(f"COPY retired_exclusions TO 's3://{DATA_BUCKET}/{key}' (FORMAT PARQUET,COMPRESSION ZSTD,OVERWRITE_OR_IGNORE true)")
print(json.dumps({'retiredExclusions': len(rows), 'key': key}, indent=2))
