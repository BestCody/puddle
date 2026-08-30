#!/usr/bin/env python3
"""Register global B2 photos created before the uniqueness registry existed.

This is a one-time-per-snapshot bridge. It verifies existing immutable B2 JPEGs,
registers the best globally unique photo for each real canonical location through
the same MIH locks used by new imports, and publishes exclusions for every stale
or conflicting metadata row. A B2 completion marker makes subsequent hourly runs
O(1) for the same snapshot.
"""
import concurrent.futures
import hashlib
import io
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
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


def safe_partition(value, label):
    value = str(value or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value) or '..' in value:
        raise ValueError(f'{label} contains an unsafe partition value')
    return value


SUPABASE_URL = first_env('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL').rstrip('/')
SUPABASE_KEY = first_env('SUPABASE_SECRET_KEY')
DATA_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
DATA_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
DATA_ENDPOINT = DATA_ENDPOINT_URL.replace('https://', '').replace('http://', '')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
MEDIA_BUCKET = first_env('B2_MEDIA_BUCKET_NAME', 'B2_BUCKET', default=DATA_BUCKET)
MEDIA_ENDPOINT = first_env('B2_MEDIA_S3_ENDPOINT', 'B2_S3_ENDPOINT', default=DATA_ENDPOINT_URL).rstrip('/')
MEDIA_KEY_ID = first_env('B2_MEDIA_KEY_ID', 'B2_MEDIA_APPLICATION_KEY_ID', 'B2_KEY_ID', default=DATA_KEY_ID)
MEDIA_KEY = first_env('B2_MEDIA_APPLICATION_KEY', 'B2_APPLICATION_KEY', default=DATA_KEY)
SNAPSHOT = str(os.getenv('GLOBAL_LOCATION_SNAPSHOT', '')).strip()
CONCURRENCY = max(1, min(64, int(os.getenv('GLOBAL_PHOTO_EXISTING_RECONCILE_CONCURRENCY', '32'))))
PROVIDER_CODES = {'wikimedia-commons': 1, 'mapillary': 2, 'kartaview': 3, 'yfcc100m': 4}
MAX_IMAGE_BYTES = 10_000_000
MAX_SOURCE_PIXELS = 40_000_000

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError('Supabase URL and service secret are required.')
if not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY:
    raise RuntimeError('B2 data credentials are required.')
if not MEDIA_ENDPOINT or not MEDIA_KEY_ID or not MEDIA_KEY:
    raise RuntimeError('B2 media credentials are required.')
if not SNAPSHOT:
    raise RuntimeError('GLOBAL_LOCATION_SNAPSHOT is required.')
if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', SNAPSHOT):
    raise RuntimeError('GLOBAL_LOCATION_SNAPSHOT must be an ISO date snapshot.')
SNAPSHOT = safe_partition(SNAPSHOT, 'snapshot')

PHOTO_PREFIX = f'{DATA_PREFIX}/enrichment/photo_metadata/snapshot={SNAPSHOT}'
EXCLUSION_PREFIX = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={SNAPSHOT}'
STATE_KEY = f'{DATA_PREFIX}/enrichment/photo_registry_state/snapshot={SNAPSHOT}/existing-global-reconciled-v1.json'

media_s3 = boto3.client(
    's3', endpoint_url=MEDIA_ENDPOINT, aws_access_key_id=MEDIA_KEY_ID, aws_secret_access_key=MEDIA_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(64, CONCURRENCY * 2)),
)
data_s3 = boto3.client(
    's3', endpoint_url=DATA_ENDPOINT_URL, aws_access_key_id=DATA_KEY_ID, aws_secret_access_key=DATA_KEY,
    region_name=DATA_REGION, config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)


def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=DATA_BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))


def state_complete():
    try:
        payload = json.loads(data_s3.get_object(Bucket=DATA_BUCKET, Key=STATE_KEY)['Body'].read())
        return payload.get('version') == 1 and payload.get('complete') is True
    except Exception:
        return False


def rpc(name, payload, retries=6):
    url = f'{SUPABASE_URL}/rest/v1/rpc/{urllib.parse.quote(name)}'
    body = json.dumps(payload, separators=(',', ':')).encode()
    headers = {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
        'User-Agent': 'Puddle/1.0 existing global photo reconciliation',
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


def verify_and_register(row):
    provider = str(row['provider'])
    provider_code = PROVIDER_CODES.get(provider)
    if not provider_code:
        raise RuntimeError(f'unsupported existing provider {provider!r}')
    external_id = str(row.get('external_photo_id') or '').strip()
    storage_key = str(row.get('storage_key') or '').strip()
    expected = str(row.get('content_hash') or '').lower().strip()
    expected_key = f'media/photos/by-sha256/{expected[:2]}/{expected}.jpg' if re.fullmatch(r'[0-9a-f]{64}', expected) else ''
    if not external_id or not storage_key or not expected_key or storage_key != expected_key:
        raise RuntimeError('existing global photo metadata is missing canonical identity fields')

    head = media_s3.head_object(Bucket=MEDIA_BUCKET, Key=storage_key)
    declared_size = int(head.get('ContentLength') or 0)
    if declared_size <= 0 or declared_size > MAX_IMAGE_BYTES:
        raise RuntimeError(f'existing global photo exceeds the {MAX_IMAGE_BYTES}-byte safety limit')
    response = media_s3.get_object(Bucket=MEDIA_BUCKET, Key=storage_key)
    stream = response['Body']
    try:
        body = stream.read(MAX_IMAGE_BYTES + 1)
    finally:
        stream.close()
    if len(body) != declared_size or len(body) > MAX_IMAGE_BYTES:
        raise RuntimeError('existing global photo body size verification failed')
    actual = hashlib.sha256(body).hexdigest()
    if actual != expected:
        raise RuntimeError(f'B2 SHA-256 mismatch for {row["location_id"]}: expected {expected}, got {actual}')
    with Image.open(io.BytesIO(body)) as original:
        if original.width * original.height > MAX_SOURCE_PIXELS:
            raise RuntimeError('existing global photo has too many pixels')
        image = ImageOps.exif_transpose(original).convert('RGB')
        perceptual = dhash(image)
        confirmation = average_hash(image)
    provider_hash = hashlib.sha256(provider.encode() + b'\0' + external_id.encode()).hexdigest()
    response = rpc('register_existing_global_photo_v1', {
        'p_location_id': str(row['location_id']),
        'p_provider_code': provider_code,
        'p_provider_asset_sha256': provider_hash,
        'p_content_sha256': expected,
        'p_perceptual_hash': perceptual,
        'p_confirmation_hash': confirmation,
        'p_snapshot': SNAPSHOT,
        'p_storage_key': storage_key,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise RuntimeError(f'invalid existing global registration response: {response!r}')
    return response[0]


def reconcile_location(rows):
    exclusions = []
    winner_index = None
    for index, row in enumerate(rows):
        result = verify_and_register(row)
        status = result.get('registration_status')
        if status in {'registered', 'already_registered'}:
            winner_index = index
            break
        if status != 'conflict':
            raise RuntimeError(f'unexpected registration status {status!r}')
        exclusions.append({
            'location_id': str(row['location_id']), 'content_hash': str(row['content_hash']).lower(),
            'reason': str(result.get('conflict_kind') or 'registry_conflict'),
            'conflict_location_id': result.get('conflict_location_id'),
        })

    if winner_index is not None:
        # Only the registry-owned image may remain eligible for serving. Lower
        # historical alternatives are excluded so they cannot resurface later.
        for row in rows[winner_index + 1:]:
            exclusions.append({
                'location_id': str(row['location_id']), 'content_hash': str(row['content_hash']).lower(),
                'reason': 'noncanonical_existing_global_photo', 'conflict_location_id': str(row['location_id']),
            })
        return 'registered', exclusions
    return 'exhausted', exclusions


def write_country_exclusions(con, country, rows):
    con.execute('DROP TABLE IF EXISTS reconcile_exclusions')
    con.execute('CREATE TEMP TABLE reconcile_exclusions(location_id VARCHAR,content_hash VARCHAR,reason VARCHAR,conflict_location_id VARCHAR,reconciled_at VARCHAR)')
    reconciled_at = datetime.now(timezone.utc).isoformat()
    if rows:
        unique = {}
        for row in rows:
            unique[(row['location_id'], row['content_hash'])] = row
        con.executemany('INSERT INTO reconcile_exclusions VALUES (?,?,?,?,?)', [(
            row['location_id'], row['content_hash'], row['reason'], row.get('conflict_location_id'), reconciled_at
        ) for row in unique.values()])
    safe = ''.join(ch for ch in str(country).upper() if ch.isalnum() or ch in {'-','_'}) or 'ZZ'
    key = f'{EXCLUSION_PREFIX}/existing-global-{safe}.parquet'
    with tempfile.NamedTemporaryFile(suffix='.parquet', delete=False) as handle:
        local_path = handle.name
    try:
        escaped = local_path.replace("'", "''")
        con.execute(f"COPY reconcile_exclusions TO '{escaped}' (FORMAT PARQUET,COMPRESSION ZSTD)")
        with open(local_path, 'rb') as handle:
            payload = handle.read()
        data_s3.put_object(
            Bucket=DATA_BUCKET, Key=key, Body=payload,
            ContentType='application/vnd.apache.parquet',
            Metadata={'purpose': 'puddle_existing_global_photo_exclusions', 'snapshot': SNAPSHOT, 'country': safe},
        )
    finally:
        try:
            os.remove(local_path)
        except FileNotFoundError:
            pass
    return key


if state_complete():
    print(json.dumps({'snapshot': SNAPSHOT, 'alreadyReconciled': True, 'stateKey': STATE_KEY}, indent=2))
    raise SystemExit(0)

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(16, CONCURRENCY))}")
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")

if not prefix_exists(PHOTO_PREFIX):
    summary = {'version': 1, 'complete': True, 'snapshot': SNAPSHOT, 'locations': 0, 'metadataRows': 0, 'excluded': 0, 'completedAt': datetime.now(timezone.utc).isoformat()}
    data_s3.put_object(Bucket=DATA_BUCKET, Key=STATE_KEY, Body=(json.dumps(summary, indent=2)+'\n').encode(), ContentType='application/json')
    print(json.dumps(summary, indent=2))
    raise SystemExit(0)

photo_glob = f's3://{DATA_BUCKET}/{PHOTO_PREFIX}/country_code=*/*.parquet'
con.execute(f"CREATE OR REPLACE TEMP VIEW pre_registry_photos AS SELECT *,upper(cast(country_code AS VARCHAR)) country_partition FROM read_parquet('{photo_glob}',union_by_name=true,hive_partitioning=true)")
if prefix_exists(EXCLUSION_PREFIX):
    con.execute(f"CREATE OR REPLACE TEMP VIEW prior_exclusions AS SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('s3://{DATA_BUCKET}/{EXCLUSION_PREFIX}/*.parquet',union_by_name=true)")
else:
    con.execute("CREATE OR REPLACE TEMP VIEW prior_exclusions AS SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false")

countries = [safe_partition(row[0], 'country') for row in con.execute('SELECT DISTINCT country_partition FROM pre_registry_photos WHERE country_partition IS NOT NULL ORDER BY 1').fetchall()]
totals = {'locations': 0, 'metadataRows': 0, 'registeredLocations': 0, 'exhaustedLocations': 0, 'excluded': 0, 'failed': 0}
exclusion_keys = []
for country in countries:
    loc = f"s3://{DATA_BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={SNAPSHOT}/country_code={country}/locations.parquet"
    rows = con.execute(f"""
      WITH valid AS (
        SELECT
          cast(p.location_id AS VARCHAR) location_id,
          cast(p.provider AS VARCHAR) provider,
          cast(p.external_photo_id AS VARCHAR) external_photo_id,
          cast(p.storage_key AS VARCHAR) storage_key,
          lower(cast(p.content_hash AS VARCHAR)) content_hash,
          coalesce(try_cast(p.rank_score AS DOUBLE),0) rank_score,
          coalesce(try_cast(p.verified_at AS TIMESTAMP),TIMESTAMP '1970-01-01') verified_at,
          row_number() over(
            partition by cast(p.location_id AS VARCHAR)
            order by coalesce(try_cast(p.verified_at AS TIMESTAMP),TIMESTAMP '1970-01-01') desc,
                     coalesce(try_cast(p.rank_score AS DOUBLE),0) desc,
                     cast(p.provider AS VARCHAR),cast(p.external_photo_id AS VARCHAR)
          ) candidate_rank
        FROM pre_registry_photos p
        JOIN read_parquet('{loc}') l ON cast(l.id AS VARCHAR)=cast(p.location_id AS VARCHAR)
        WHERE p.country_partition='{country}'
          AND NOT EXISTS (
            SELECT 1 FROM prior_exclusions x
            WHERE x.location_id=cast(p.location_id AS VARCHAR)
              AND x.content_hash=lower(cast(p.content_hash AS VARCHAR))
          )
      )
      SELECT location_id,provider,external_photo_id,storage_key,content_hash,rank_score,verified_at,candidate_rank
      FROM valid
      ORDER BY location_id,candidate_rank
    """).fetchall()
    cols = ['location_id','provider','external_photo_id','storage_key','content_hash','rank_score','verified_at','candidate_rank']
    grouped = defaultdict(list)
    for values in rows:
        row = dict(zip(cols, values))
        grouped[row['location_id']].append(row)
    totals['metadataRows'] += len(rows)
    totals['locations'] += len(grouped)
    country_exclusions = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        future_map = {pool.submit(reconcile_location, candidates): location_id for location_id, candidates in grouped.items()}
        for future in concurrent.futures.as_completed(future_map):
            location_id = future_map[future]
            try:
                status, exclusions = future.result()
                country_exclusions.extend(exclusions)
                if status == 'registered':
                    totals['registeredLocations'] += 1
                else:
                    totals['exhaustedLocations'] += 1
            except Exception as error:
                totals['failed'] += 1
                print(json.dumps({'location_id': location_id, 'reconcileError': str(error)[:500]}), flush=True)
    if totals['failed']:
        raise RuntimeError('existing global photo reconciliation failed; completion marker was not written')
    totals['excluded'] += len({(row['location_id'],row['content_hash']) for row in country_exclusions})
    exclusion_keys.append(write_country_exclusions(con, country, country_exclusions))
    print(json.dumps({'country': country, 'locations': len(grouped), 'metadataRows': len(rows), 'excluded': len(country_exclusions)}, indent=2), flush=True)

summary = {
    'version': 1, 'complete': True, 'snapshot': SNAPSHOT, **totals,
    'exclusionKeys': exclusion_keys, 'completedAt': datetime.now(timezone.utc).isoformat(),
}
data_s3.put_object(Bucket=DATA_BUCKET, Key=STATE_KEY, Body=(json.dumps(summary, indent=2)+'\n').encode(), ContentType='application/json')
print(json.dumps(summary, indent=2), flush=True)
