#!/usr/bin/env python3
"""Backfill MIH fingerprints for historical B2 photos and retire duplicates.

New global imports are fingerprinted before upload. Historical relational photos
predate that invariant, so this bounded worker reads only registry rows whose
perceptual hash is NULL, fingerprints their already-normalized B2 JPEG, and lets
the same transactionally locked MIH registry choose one owner for near-identical
images. Losing historical rows are retired and emitted as small B2 exclusion
Parquets so the current active snapshot can stop serving/skipping them before the
next full bootstrap-overlay rebuild.
"""
import concurrent.futures
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config
from PIL import Image, ImageOps


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
MEDIA_BUCKET = first_env('B2_MEDIA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
MEDIA_ENDPOINT = first_env('B2_MEDIA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
MEDIA_KEY_ID = first_env('B2_MEDIA_KEY_ID', 'B2_MEDIA_APPLICATION_KEY_ID', 'B2_KEY_ID')
MEDIA_KEY = first_env('B2_MEDIA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default=MEDIA_BUCKET)
DATA_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
DATA_ENDPOINT = DATA_ENDPOINT_URL.replace('https://', '').replace('http://', '')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
SNAPSHOT = str(os.getenv('GLOBAL_LOCATION_SNAPSHOT', '')).strip()
CONCURRENCY = max(1, min(128, int(os.getenv('GLOBAL_PHOTO_FINGERPRINT_BACKFILL_CONCURRENCY', '64'))))
RPC_BATCH = max(100, min(5000, int(os.getenv('GLOBAL_PHOTO_FINGERPRINT_BACKFILL_BATCH', '5000'))))
MAX_ROUNDS = max(1, min(100, int(os.getenv('GLOBAL_PHOTO_FINGERPRINT_BACKFILL_ROUNDS', '20'))))

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError('Supabase URL and service secret are required.')
if not MEDIA_ENDPOINT or not MEDIA_KEY_ID or not MEDIA_KEY:
    raise RuntimeError('B2 media credentials are required.')
if not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY:
    raise RuntimeError('B2 data credentials are required.')
if not SNAPSHOT:
    raise RuntimeError('GLOBAL_LOCATION_SNAPSHOT is required.')

media_s3 = boto3.client(
    's3', endpoint_url=MEDIA_ENDPOINT, aws_access_key_id=MEDIA_KEY_ID, aws_secret_access_key=MEDIA_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(128, CONCURRENCY * 2)),
)


def rpc(name, payload, retries=6):
    url = f'{SUPABASE_URL}/rest/v1/rpc/{urllib.parse.quote(name)}'
    body = json.dumps(payload, separators=(',', ':')).encode()
    headers = {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
        'User-Agent': 'Puddle/1.0 global photo fingerprint backfill',
    }
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, method='POST', headers=headers), timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read().decode(errors='replace')[:800]
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt + 1 >= retries:
                raise RuntimeError(f'Supabase RPC {name} failed with {error.code}: {raw}') from error
            retry_after = error.headers.get('Retry-After')
            time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else min(20, 0.5 * (2 ** attempt)))
        except Exception:
            if attempt + 1 >= retries:
                raise
            time.sleep(min(10, 0.5 * (2 ** attempt)))
    raise RuntimeError(f'Supabase RPC {name} exhausted retries')


def dhash(image):
    gray = image.convert('L').resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (1 if pixels[row * 9 + col] > pixels[row * 9 + col + 1] else 0)
    return f'{bits:016x}'


def average_hash(image):
    gray = image.convert('L').resize((8, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    average = sum(pixels) / len(pixels)
    bits = 0
    for value in pixels:
        bits = (bits << 1) | (1 if value >= average else 0)
    return f'{bits:016x}'


def fingerprint(row):
    body = media_s3.get_object(Bucket=MEDIA_BUCKET, Key=row['storage_key'])['Body'].read()
    actual = hashlib.sha256(body).hexdigest()
    expected = str(row['content_sha256']).lower()
    if actual != expected:
        raise RuntimeError(f'B2 SHA-256 mismatch for {row["location_id"]}: expected {expected}, got {actual}')
    with Image.open(io.BytesIO(body)) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        perceptual = dhash(image)
        confirmation = average_hash(image)
    response = rpc('backfill_global_photo_fingerprint_v1', {
        'p_location_id': row['location_id'],
        'p_content_sha256': expected,
        'p_perceptual_hash': perceptual,
        'p_confirmation_hash': confirmation,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise RuntimeError(f'invalid fingerprint backfill response: {response!r}')
    result = response[0]
    status = result.get('backfill_status')
    if status == 'near_duplicate':
        retired = rpc('retire_duplicate_global_photo_claim_v1', {
            'p_location_id': row['location_id'], 'p_content_sha256': expected,
        })
        if retired is not True:
            raise RuntimeError(f'could not retire duplicate historical claim {row["location_id"]}')
        return {
            'status': 'retired', 'location_id': row['location_id'], 'content_hash': expected,
            'reason': 'near_duplicate', 'conflict_location_id': result.get('conflict_location_id'),
        }
    if status in {'updated', 'already_fingerprinted', 'missing'}:
        return {'status': status, 'location_id': row['location_id'], 'content_hash': expected}
    raise RuntimeError(f'unexpected fingerprint backfill status {status!r}')


def write_exclusions(rows):
    if not rows:
        return None
    con = duckdb.connect()
    con.execute('INSTALL httpfs; LOAD httpfs;')
    con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")
    con.execute('CREATE TEMP TABLE exclusions(location_id VARCHAR,content_hash VARCHAR,reason VARCHAR,conflict_location_id VARCHAR,retired_at VARCHAR)')
    retired_at = datetime.now(timezone.utc).isoformat()
    con.executemany('INSERT INTO exclusions VALUES (?,?,?,?,?)', [(
        row['location_id'], row['content_hash'], row['reason'], row.get('conflict_location_id'), retired_at
    ) for row in rows])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    key = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={SNAPSHOT}/part-{stamp}.parquet'
    con.execute(f"COPY exclusions TO 's3://{DATA_BUCKET}/{key}' (FORMAT PARQUET,COMPRESSION ZSTD)")
    return key


totals = {'updated': 0, 'retired': 0, 'already_fingerprinted': 0, 'missing': 0, 'failed': 0}
retired_rows = []
for round_index in range(MAX_ROUNDS):
    pending = rpc('list_global_photo_fingerprint_backfill_v1', {'p_limit': RPC_BATCH}) or []
    if not pending:
        break
    print(f'fingerprint backfill round {round_index + 1}: {len(pending)} historical photos', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        future_map = {pool.submit(fingerprint, row): row for row in pending}
        for future in concurrent.futures.as_completed(future_map):
            row = future_map[future]
            try:
                result = future.result()
                status = result['status']
                totals[status] = totals.get(status, 0) + 1
                if status == 'retired':
                    retired_rows.append(result)
            except Exception as error:
                totals['failed'] += 1
                print(json.dumps({'location_id': row.get('location_id'), 'fingerprintError': str(error)[:500]}), flush=True)
    if totals['failed']:
        # Fail closed rather than repeatedly selecting a permanently bad row and
        # pretending the historical registry is fully fingerprinted.
        break

exclusion_key = write_exclusions(retired_rows)
remaining = rpc('list_global_photo_fingerprint_backfill_v1', {'p_limit': 1}) or []
print(json.dumps({
    **totals,
    'remaining': bool(remaining),
    'exclusionKey': exclusion_key,
}, indent=2), flush=True)
if totals['failed'] or remaining:
    raise RuntimeError('historical photo fingerprint backfill is incomplete')
