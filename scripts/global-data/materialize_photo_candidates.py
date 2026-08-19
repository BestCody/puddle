#!/usr/bin/env python3
"""Materialize globally unique licensed location photos into immutable B2 media.

Discovery remains bulk/spatial. For each real canonical location this worker keeps
several ranked provider candidates, downloads them one at a time, and atomically
claims exact/perceptual identity in Postgres before uploading bytes. Duplicate
candidates fall through to the next candidate for that location. Different
locations are processed concurrently.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import threading
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


parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--countries', default=os.getenv('GLOBAL_PHOTO_COUNTRIES', ''))
parser.add_argument('--limit', type=int, default=int(os.getenv('GLOBAL_PHOTO_MATERIALIZE_LIMIT', '10000')))
args = parser.parse_args()

DATA_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
DATA_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
DATA_ENDPOINT = DATA_ENDPOINT_URL.replace('https://', '').replace('http://', '')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
MEDIA_BUCKET = first_env('B2_MEDIA_BUCKET_NAME', 'B2_BUCKET', default=DATA_BUCKET)
MEDIA_ENDPOINT = first_env('B2_MEDIA_S3_ENDPOINT', 'B2_S3_ENDPOINT', default=DATA_ENDPOINT_URL)
MEDIA_KEY_ID = first_env('B2_MEDIA_KEY_ID', 'B2_MEDIA_APPLICATION_KEY_ID', 'B2_KEY_ID', default=DATA_KEY_ID)
MEDIA_KEY = first_env('B2_MEDIA_APPLICATION_KEY', 'B2_APPLICATION_KEY', default=DATA_KEY)
MEDIA_PREFIX = clean_prefix(first_env('B2_MEDIA_OPEN_PHOTO_PREFIX', default='media/photos/by-sha256'))
SUPABASE_URL = first_env('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL').rstrip('/')
SUPABASE_KEY = first_env('SUPABASE_SECRET_KEY')
MAPILLARY_TOKEN = os.getenv('MAPILLARY_ACCESS_TOKEN', '').strip()
CONCURRENCY = max(1, min(256, int(os.getenv('GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY', '96'))))
LIMIT = max(1, min(1_000_000, args.limit))
FALLBACK_CANDIDATES = max(1, min(12, int(os.getenv('GLOBAL_PHOTO_FALLBACK_CANDIDATES', '9'))))
LOCATION_BATCH = max(100, min(10_000, int(os.getenv('GLOBAL_PHOTO_LOCATION_BATCH', '2500'))))
CLAIM_LEASE_SECONDS = max(300, min(3600, int(os.getenv('GLOBAL_PHOTO_CLAIM_LEASE_SECONDS', '1200'))))
MAX_BYTES = 10_000_000
PROVIDER_CODES = {'wikimedia-commons': 1, 'mapillary': 2, 'kartaview': 3}
TRANSIENT_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}
WIKIMEDIA_DOWNLOAD_CONCURRENCY = max(1, min(2, int(os.getenv('GLOBAL_PHOTO_WIKIMEDIA_DOWNLOAD_CONCURRENCY', '2'))))
WIKIMEDIA_DOWNLOAD_MBIT = max(1.0, min(25.0, float(os.getenv('GLOBAL_PHOTO_WIKIMEDIA_DOWNLOAD_MBIT', '25'))))
WIKIMEDIA_DOWNLOAD_BYTES_PER_SECOND = WIKIMEDIA_DOWNLOAD_MBIT * 1_000_000 / 8.0
WIKIMEDIA_DOWNLOAD_GATE = threading.BoundedSemaphore(WIKIMEDIA_DOWNLOAD_CONCURRENCY)
WIKIMEDIA_BANDWIDTH_LOCK = threading.Lock()
WIKIMEDIA_BANDWIDTH_NEXT_AT = 0.0
MAPILLARY_GRAPH_REQUESTS_PER_MINUTE = max(1, min(50_000, int(os.getenv('MAPILLARY_GRAPH_REQUESTS_PER_MINUTE', '50000'))))
MAPILLARY_GRAPH_START_INTERVAL = 60.0 / MAPILLARY_GRAPH_REQUESTS_PER_MINUTE
MAPILLARY_GRAPH_LOCK = threading.Lock()
MAPILLARY_GRAPH_NEXT_AT = 0.0
EXCLUSION_PREFIX = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={args.snapshot}'

if not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY:
    raise RuntimeError('B2 data endpoint and credentials are required.')
if not MEDIA_ENDPOINT or not MEDIA_KEY_ID or not MEDIA_KEY:
    raise RuntimeError('B2 media endpoint and credentials are required.')
if not MEDIA_PREFIX:
    raise RuntimeError('B2 media photo prefix is empty.')
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError('Supabase URL and service secret are required for global photo uniqueness claims.')

s3 = boto3.client(
    's3', endpoint_url=MEDIA_ENDPOINT, aws_access_key_id=MEDIA_KEY_ID, aws_secret_access_key=MEDIA_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(128, CONCURRENCY * 2)),
)
data_s3 = boto3.client(
    's3', endpoint_url=DATA_ENDPOINT_URL, aws_access_key_id=DATA_KEY_ID, aws_secret_access_key=DATA_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)


def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=DATA_BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))


def object_exists(key):
    listing = data_s3.list_objects_v2(Bucket=DATA_BUCKET, Prefix=key, MaxKeys=1)
    return any(str(item.get('Key') or '') == key for item in listing.get('Contents', []))


def supabase_rpc(name, payload, retries=6):
    url = f'{SUPABASE_URL}/rest/v1/rpc/{urllib.parse.quote(name)}'
    body = json.dumps(payload, separators=(',', ':')).encode()
    headers = {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
        'User-Agent': 'Puddle/1.0 global photo materializer',
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


def cleanup_expired_claims():
    value = supabase_rpc('cleanup_expired_global_photo_claims_v1', {'p_limit': 50_000})
    print(f'photo claim cleanup removed {value or 0} expired leases', flush=True)


def claim_photo(row, content_hash, perceptual_hash, confirmation_hash):
    provider = row['provider']
    provider_code = PROVIDER_CODES.get(provider)
    if not provider_code:
        raise RuntimeError(f'unsupported provider {provider}')
    external_id = str(row['external_photo_id'])
    provider_hash = hashlib.sha256(provider.encode() + b'\0' + external_id.encode()).hexdigest()
    response = supabase_rpc('claim_global_photo_v1', {
        'p_location_id': str(row['location_id']),
        'p_provider_code': provider_code,
        'p_provider_asset_sha256': provider_hash,
        'p_content_sha256': content_hash,
        'p_perceptual_hash': perceptual_hash,
        'p_confirmation_hash': confirmation_hash,
        'p_snapshot': str(args.snapshot),
        'p_lease_seconds': CLAIM_LEASE_SECONDS,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise RuntimeError(f'invalid global photo claim response: {response!r}')
    return response[0]


def release_claim(token):
    if token:
        try:
            supabase_rpc('release_global_photo_claim_v1', {'p_claim_token': token})
        except Exception as error:
            print(f'warning: failed to release photo claim {token}: {error}', flush=True)


def finalize_claim(token, storage_key):
    result = supabase_rpc('finalize_global_photo_claim_v1', {'p_claim_token': token, 'p_storage_key': storage_key})
    if result is not True:
        raise RuntimeError('global photo claim could not be finalized after B2 verification')


def wait_mapillary_graph_start():
    global MAPILLARY_GRAPH_NEXT_AT
    with MAPILLARY_GRAPH_LOCK:
        now = time.monotonic()
        start = max(now, MAPILLARY_GRAPH_NEXT_AT)
        MAPILLARY_GRAPH_NEXT_AT = start + MAPILLARY_GRAPH_START_INTERVAL
    if start > now:
        time.sleep(start - now)


def reserve_wikimedia_bandwidth(byte_count):
    global WIKIMEDIA_BANDWIDTH_NEXT_AT
    duration = max(0, int(byte_count)) / WIKIMEDIA_DOWNLOAD_BYTES_PER_SECOND
    with WIKIMEDIA_BANDWIDTH_LOCK:
        now = time.monotonic()
        start = max(now, WIKIMEDIA_BANDWIDTH_NEXT_AT)
        WIKIMEDIA_BANDWIDTH_NEXT_AT = start + duration
    if start > now:
        time.sleep(start - now)


def mapillary_details(image_id):
    if not MAPILLARY_TOKEN:
        raise RuntimeError('MAPILLARY_ACCESS_TOKEN is required to materialize Mapillary candidates.')
    fields = 'id,thumb_2048_url,width,height,creator,quality_score'
    url = f'https://graph.mapillary.com/{urllib.parse.quote(str(image_id))}?' + urllib.parse.urlencode({'fields': fields})
    for attempt in range(6):
        wait_mapillary_graph_start()
        try:
            request = urllib.request.Request(url, headers={
                'Accept': 'application/json',
                'Authorization': f'OAuth {MAPILLARY_TOKEN}',
                'User-Agent': 'Puddle/1.0 global photo materializer (https://puddle.you/)',
            })
            with urllib.request.urlopen(request, timeout=20) as response:
                row = json.load(response)
            creator = str((row.get('creator') or {}).get('username') or (row.get('creator') or {}).get('name') or 'Mapillary contributor').strip()
            return {
                'asset_url': row.get('thumb_2048_url'),
                'page_url': f'https://www.mapillary.com/app/?pKey={urllib.parse.quote(str(image_id))}&focus=photo',
                'attribution': f'{creator} · Mapillary · CC BY-SA 4.0',
                'license': 'CC-BY-SA-4.0', 'license_url': 'https://creativecommons.org/licenses/by-sa/4.0/'
            }
        except urllib.error.HTTPError as error:
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5:
                raise
            retry = error.headers.get('Retry-After')
            time.sleep(float(retry) if retry and retry.isdigit() else min(30, 0.5 * (2 ** attempt)))
        except Exception:
            if attempt == 5:
                raise
            time.sleep(min(10, 0.5 * (2 ** attempt)))
    raise RuntimeError('Mapillary image lookup failed.')


def approved_host(provider, hostname):
    host = hostname.lower()
    if provider == 'wikimedia-commons':
        return host == 'upload.wikimedia.org'
    if provider == 'mapillary':
        return host.endswith('.fbcdn.net') or host == 'fbcdn.net' or host.endswith('.mapillary.com') or host == 'mapillary.com'
    if provider == 'kartaview':
        return host.endswith('.openstreetcam.org') or host == 'openstreetcam.org' or host.endswith('.kartaview.org') or host == 'kartaview.org'
    return False


def download(url, provider):
    current = str(url or '')
    redirects = 0
    for attempt in range(6):
        parsed = urllib.parse.urlparse(current)
        if parsed.scheme != 'https' or not approved_host(provider, parsed.hostname or ''):
            raise RuntimeError(f'unapproved {provider} asset host')
        request = urllib.request.Request(current, headers={
            'Accept': 'image/avif,image/webp,image/png,image/jpeg',
            'User-Agent': 'Puddle/1.0 licensed photo materializer (https://puddle.you/)',
        })
        gate = WIKIMEDIA_DOWNLOAD_GATE if provider == 'wikimedia-commons' else None
        if gate:
            gate.acquire()
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_type = (response.headers.get_content_type() or '').lower()
                declared = int(response.headers.get('Content-Length') or 0)
                if declared > MAX_BYTES:
                    raise RuntimeError('image exceeds 10 MB')
                if provider == 'wikimedia-commons':
                    chunks = []
                    total = 0
                    while total <= MAX_BYTES:
                        chunk_size = min(64 * 1024, MAX_BYTES + 1 - total)
                        if chunk_size <= 0:
                            break
                        reserve_wikimedia_bandwidth(chunk_size)
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        chunks.append(chunk)
                        total += len(chunk)
                    body = b''.join(chunks)
                else:
                    body = response.read(MAX_BYTES + 1)
                if not body or len(body) > MAX_BYTES:
                    raise RuntimeError('image is empty or exceeds 10 MB')
                if content_type not in {'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/octet-stream'}:
                    raise RuntimeError(f'unsupported image type {content_type}')
                return body
        except urllib.error.HTTPError as error:
            if error.code in {301, 302, 303, 307, 308} and error.headers.get('Location'):
                redirects += 1
                if redirects > 3:
                    raise RuntimeError('too many image redirects') from error
                current = urllib.parse.urljoin(current, error.headers['Location'])
                continue
            if error.code in TRANSIENT_HTTP_CODES and attempt < 5:
                retry_after = error.headers.get('Retry-After')
                try:
                    delay = float(retry_after) if retry_after else 0.0
                except ValueError:
                    delay = 0.0
                if delay <= 0:
                    delay = min(30.0, 0.5 * (2 ** attempt))
                time.sleep(min(60.0, delay))
                continue
            raise
        finally:
            if gate:
                gate.release()
    raise RuntimeError(f'{provider} image download exhausted retries')

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


def normalize(body):
    with Image.open(io.BytesIO(body)) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        if image.width > 1600 or image.height > 1000:
            image.thumbnail((1600, 1000), Image.Resampling.LANCZOS)
        perceptual = dhash(image)
        confirmation = average_hash(image)
        out = io.BytesIO()
        image.save(out, format='JPEG', quality=84, optimize=True, progressive=True)
        data = out.getvalue()
        return data, image.width, image.height, perceptual, confirmation


def upload_media(data, sha256):
    key = f'{MEDIA_PREFIX}/{sha256[:2]}/{sha256}.jpg'
    try:
        head = s3.head_object(Bucket=MEDIA_BUCKET, Key=key)
        if int(head.get('ContentLength', -1)) == len(data) and head.get('Metadata', {}).get('sha256') == sha256:
            return key
    except Exception:
        pass
    s3.put_object(
        Bucket=MEDIA_BUCKET, Key=key, Body=data, ContentType='image/jpeg',
        CacheControl='public, max-age=31536000, immutable',
        Metadata={'sha256': sha256, 'purpose': 'puddle_open_location_photo'},
    )
    head = s3.head_object(Bucket=MEDIA_BUCKET, Key=key)
    if int(head.get('ContentLength', -1)) != len(data):
        raise RuntimeError('B2 media size verification failed')
    if head.get('Metadata', {}).get('sha256') != sha256:
        raise RuntimeError('B2 media SHA256 metadata verification failed')
    return key


def prepare_candidate(row):
    provider = row['provider']
    candidate = dict(row)
    if provider == 'mapillary':
        candidate.update(mapillary_details(row['external_photo_id']))
    body = download(candidate.get('asset_url'), provider)
    normalized, width, height, perceptual, confirmation = normalize(body)
    content_hash = hashlib.sha256(normalized).hexdigest()
    return candidate, normalized, width, height, perceptual, confirmation, content_hash


def materialize_location(candidates):
    location_id = str(candidates[0]['location_id'])
    attempts = []
    for row in candidates:
        try:
            candidate, normalized, width, height, perceptual, confirmation, content_hash = prepare_candidate(row)
            claim = claim_photo(row, content_hash, perceptual, confirmation)
            claim_status = claim.get('claim_status')
            conflict_kind = claim.get('conflict_kind')
            if claim_status != 'claimed':
                attempts.append({'provider': row['provider'], 'candidateRank': row['candidate_rank'], 'conflict': conflict_kind or claim_status})
                if conflict_kind == 'location_has_photo':
                    return None, {'location_id': location_id, 'status': 'already_claimed', 'attempts': attempts}
                continue
            token = claim.get('claim_token')
            if not token:
                raise RuntimeError('claim succeeded without a token')
            try:
                key = upload_media(normalized, content_hash)
                finalize_claim(token, key)
            except Exception:
                release_claim(token)
                raise
            return {
                'location_id': location_id, 'provider': row['provider'], 'external_photo_id': row['external_photo_id'],
                'storage_backend': 'b2', 'storage_key': key, 'content_hash': content_hash, 'perceptual_hash': perceptual,
                'byte_size': len(normalized), 'width': width, 'height': height, 'attribution': candidate.get('attribution'),
                'attribution_url': candidate.get('page_url'), 'license': candidate.get('license'), 'license_url': candidate.get('license_url'),
                'rank_score': float(row.get('rank_score') or 0), 'verified_at': datetime.now(timezone.utc).isoformat()
            }, {'location_id': location_id, 'status': 'materialized', 'attempts': attempts, 'winnerRank': row['candidate_rank']}
        except Exception as error:
            attempts.append({'provider': row['provider'], 'candidateRank': row['candidate_rank'], 'error': str(error)[:240]})
    return None, {'location_id': location_id, 'status': 'exhausted', 'attempts': attempts}


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")
con.execute('CREATE TEMP TABLE attempted_photo_locations(location_id VARCHAR PRIMARY KEY)')
if prefix_exists(EXCLUSION_PREFIX):
    con.execute(f"CREATE OR REPLACE TEMP VIEW photo_exclusions AS SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('s3://{DATA_BUCKET}/{EXCLUSION_PREFIX}/*.parquet',union_by_name=true)")
else:
    con.execute("CREATE OR REPLACE TEMP VIEW photo_exclusions AS SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false")


def countries():
    if args.countries.strip():
        return sorted({v.strip().upper() for v in args.countries.split(',') if v.strip()})
    glob = f's3://{DATA_BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    return [str(r[0]) for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}',hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]


def write_results(country, results):
    if not results:
        return
    con.execute('DROP TABLE IF EXISTS materialized_results')
    con.execute('CREATE TEMP TABLE materialized_results(location_id VARCHAR,provider VARCHAR,external_photo_id VARCHAR,storage_backend VARCHAR,storage_key VARCHAR,content_hash VARCHAR,perceptual_hash VARCHAR,byte_size BIGINT,width INTEGER,height INTEGER,attribution VARCHAR,attribution_url VARCHAR,license VARCHAR,license_url VARCHAR,rank_score DOUBLE,verified_at VARCHAR)')
    keys = ['location_id', 'provider', 'external_photo_id', 'storage_backend', 'storage_key', 'content_hash', 'perceptual_hash', 'byte_size', 'width', 'height', 'attribution', 'attribution_url', 'license', 'license_url', 'rank_score', 'verified_at']
    con.executemany('INSERT INTO materialized_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [tuple(r[k] for k in keys) for r in results])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out = f's3://{DATA_BUCKET}/{DATA_PREFIX}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}/part-{stamp}.parquet'
    con.execute(f"COPY materialized_results TO '{out}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000)")


# Fail closed before doing provider work if the uniqueness RPCs/migration are not live.
cleanup_expired_claims()
remaining = LIMIT
for country in countries():
    if remaining <= 0:
        break
    map_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=mapillary/snapshot={args.snapshot}/country_code={country}'
    wiki_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=wikimedia-commons/snapshot={args.snapshot}/country_code={country}'
    karta_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=kartaview/snapshot={args.snapshot}/country_code={country}'
    sources = []
    if prefix_exists(map_prefix):
        sources.append(f"SELECT location_id,provider,external_photo_id,NULL::VARCHAR asset_url,NULL::VARCHAR page_url,NULL::VARCHAR attribution,NULL::VARCHAR license,NULL::VARCHAR license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{map_prefix}/candidates.parquet')")
    if prefix_exists(wiki_prefix):
        sources.append(f"SELECT location_id,provider,external_photo_id,asset_url,page_url,attribution,license,license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{wiki_prefix}/candidates.parquet')")
    if prefix_exists(karta_prefix):
        sources.append(f"SELECT location_id,provider,external_photo_id,asset_url,page_url,attribution,license,license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{karta_prefix}/candidates.parquet')")
    if not sources:
        continue
    union = ' UNION ALL '.join(sources)
    loc = f"s3://{DATA_BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet"
    con.execute(f"CREATE OR REPLACE TEMP VIEW all_candidates AS {union}")
    existing_sources = []
    bootstrap_photo = f'{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/photo_metadata.parquet'
    if object_exists(bootstrap_photo):
        bootstrap_uri = f's3://{DATA_BUCKET}/{bootstrap_photo}'
        bootstrap_columns = {str(row[0]).lower() for row in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{bootstrap_uri}')").fetchall()}
        if 'location_id' in bootstrap_columns and 'content_hash' in bootstrap_columns:
            existing_sources.append(f"SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('{bootstrap_uri}')")
        else:
            print(f'{country}: ignoring legacy bootstrap photo metadata without content_hash', flush=True)
    enriched_prefix = f'{DATA_PREFIX}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}'
    if prefix_exists(enriched_prefix):
        enriched_uri = f's3://{DATA_BUCKET}/{enriched_prefix}/*.parquet'
        enriched_columns = {str(row[0]).lower() for row in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{enriched_uri}', union_by_name=true)").fetchall()}
        if 'location_id' in enriched_columns and 'content_hash' in enriched_columns:
            existing_sources.append(f"SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('{enriched_uri}', union_by_name=true)")
        else:
            print(f'{country}: ignoring legacy enrichment photo metadata without content_hash', flush=True)
    if existing_sources:
        con.execute(f"CREATE OR REPLACE TEMP VIEW raw_existing_photos AS {' UNION ALL '.join(existing_sources)}")
        con.execute("""CREATE OR REPLACE TEMP VIEW existing_photos AS
          SELECT DISTINCT e.location_id
          FROM raw_existing_photos e
          WHERE NOT EXISTS (
            SELECT 1 FROM photo_exclusions x
            WHERE x.location_id=e.location_id AND x.content_hash=e.content_hash
          )
        """)
    else:
        con.execute("CREATE OR REPLACE TEMP VIEW existing_photos AS SELECT NULL::VARCHAR AS location_id WHERE false")

    while remaining > 0:
        target_limit = min(remaining, LOCATION_BATCH)
        rows = con.execute(f"""
          WITH l AS (SELECT id,category FROM read_parquet('{loc}')),
          ranked AS (
            SELECT c.*,l.category,
              CASE WHEN l.category IN ('park','museum','gallery','attraction','scenic_spot')
                   THEN CASE c.provider WHEN 'wikimedia-commons' THEN 0 WHEN 'mapillary' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END
                   ELSE CASE c.provider WHEN 'mapillary' THEN 0 WHEN 'wikimedia-commons' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END END provider_rank,
              row_number() OVER(PARTITION BY c.location_id ORDER BY provider_rank,coalesce(c.rank_score,0) DESC,c.external_photo_id) candidate_rank
            FROM all_candidates c
            JOIN l ON l.id=c.location_id
            WHERE NOT EXISTS (SELECT 1 FROM existing_photos e WHERE e.location_id=cast(c.location_id AS VARCHAR))
              AND NOT EXISTS (SELECT 1 FROM attempted_photo_locations a WHERE a.location_id=cast(c.location_id AS VARCHAR))
          ), targets AS (
            SELECT location_id,min(provider_rank) best_provider,max(coalesce(rank_score,0)) best_score
            FROM ranked
            GROUP BY location_id
            ORDER BY best_provider,best_score DESC,location_id
            LIMIT {target_limit}
          )
          SELECT r.location_id,r.provider,r.external_photo_id,r.asset_url,r.page_url,r.attribution,r.license,r.license_url,r.rank_score,r.candidate_rank
          FROM ranked r JOIN targets t ON t.location_id=r.location_id
          WHERE r.candidate_rank<={FALLBACK_CANDIDATES}
          ORDER BY r.location_id,r.candidate_rank
        """).fetchall()
        if not rows:
            break
        cols = ['location_id', 'provider', 'external_photo_id', 'asset_url', 'page_url', 'attribution', 'license', 'license_url', 'rank_score', 'candidate_rank']
        grouped = defaultdict(list)
        for row in rows:
            item = dict(zip(cols, row))
            grouped[str(item['location_id'])].append(item)
        target_ids = sorted(grouped)
        con.executemany('INSERT OR IGNORE INTO attempted_photo_locations VALUES (?)', [(value,) for value in target_ids])
        remaining -= len(target_ids)

        results = []
        diagnostics = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            future_map = {pool.submit(materialize_location, grouped[location_id]): location_id for location_id in target_ids}
            for future in concurrent.futures.as_completed(future_map):
                location_id = future_map[future]
                try:
                    result, detail = future.result()
                    diagnostics.append(detail)
                    if result:
                        results.append(result)
                        if len(results) % 100 == 0:
                            print(f'{country}: materialized {len(results)} unique photos in current batch', flush=True)
                except Exception as error:
                    diagnostics.append({'location_id': location_id, 'status': 'worker_error', 'error': str(error)[:300]})
        write_results(country, results)
        exhausted = sum(1 for row in diagnostics if row.get('status') == 'exhausted')
        already_claimed = sum(1 for row in diagnostics if row.get('status') == 'already_claimed')
        duplicate_fallbacks = sum(
            1 for row in diagnostics for attempt in row.get('attempts', [])
            if attempt.get('conflict') in {'provider_asset_duplicate','exact_duplicate','near_duplicate','concurrent_unique_conflict'}
        )
        failure_samples = [row for row in diagnostics if row.get('status') not in {'materialized','already_claimed'}][:10]
        print(json.dumps({
            'country': country,
            'locationsAttempted': len(target_ids),
            'materialized': len(results),
            'duplicateFallbacks': duplicate_fallbacks,
            'alreadyClaimed': already_claimed,
            'exhausted': exhausted,
            'remainingRunBudget': remaining,
            'failureSamples': failure_samples,
        }, indent=2), flush=True)
