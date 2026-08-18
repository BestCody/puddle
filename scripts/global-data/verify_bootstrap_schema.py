#!/usr/bin/env python3
"""Validate the production bootstrap Parquet schema directly in B2.

This is a cheap preflight for the canonical global location build. It checks
exactly the bootstrap files consumed by entity resolution and overlay projection
before the expensive source mirroring and country resolver work starts.
"""
import os

import duckdb


def first_env(*names, default=''):
    for name in names:
        value = str(os.getenv(name, '')).strip()
        if value:
            return value
    return default


def clean_prefix(value):
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
BOOTSTRAP_PREFIX = clean_prefix(first_env('GLOBAL_BOOTSTRAP_B2_PREFIX', default='data/snapshots/bootstrap/current'))

if not ENDPOINT or not KEY_ID or not KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')

BOOT = f"s3://{BUCKET}/{BOOTSTRAP_PREFIX}"
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{KEY_ID.replace("'", "''")}', SECRET '{KEY.replace("'", "''")}',
 REGION '{REGION.replace("'", "''")}', ENDPOINT '{ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")


def columns(filename):
    escaped = f"{BOOT}/{filename}".replace("'", "''")
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{escaped}')").fetchall()
    result = {str(row[0]) for row in rows}
    print(f"{filename}: {', '.join(sorted(result))}", flush=True)
    return result


def require(filename, required):
    actual = columns(filename)
    missing = sorted(set(required) - actual)
    if missing:
        raise RuntimeError(f"{filename} is missing required columns: {', '.join(missing)}")
    return actual


locations = require('locations.parquet', {'id'})
if 'country' in locations:
    print("locations.parquet geography field: country (bootstrap schema verified)", flush=True)
elif 'country_code' in locations:
    print("locations.parquet geography field: country_code", flush=True)
else:
    raise RuntimeError('locations.parquet has neither country nor country_code')

require(
    'location_photo_sources.parquet',
    {
        'location_id', 'remote_url', 'provider', 'attribution_text', 'attribution_url',
        'license_code', 'width', 'height', 'is_primary', 'source', 'sort_order',
        'verified_at', 'status', 'is_ai_generated', 'expires_at',
    },
)
require(
    'location_google_places.parquet',
    {'location_id', 'google_place_id', 'match_score', 'status'},
)

print(
    'bootstrap schema preflight passed; build_bootstrap_overlays.py does not rely on '
    'a bootstrap country_code column and derives canonical country_code from normalized output paths',
    flush=True,
)
