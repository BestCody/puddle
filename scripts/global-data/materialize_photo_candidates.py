#!/usr/bin/env python3
"""Materialize globally unique licensed location photos into immutable B2 media.

Discovery remains bulk/spatial. For each real canonical location this worker keeps
several ranked provider candidates, atomically reserves an unseen provider asset
or source URL before any download, then claims exact/perceptual identity in
Postgres before uploading bytes. Duplicate candidates fall through to the next
candidate for that location. Different locations are processed concurrently.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone

import boto3
import duckdb
import urllib3
from botocore.client import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps
from kartaview_urls import canonical_asset_url


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


parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--countries', default=os.getenv('GLOBAL_PHOTO_COUNTRIES', ''))
parser.add_argument(
    '--max-locations',
    type=int,
    default=None,
    help='Optional explicit pilot bound; the production drain remains uncapped when omitted.',
)
parser.add_argument(
    '--bulk-manifest',
    default=os.getenv('GLOBAL_PHOTO_BULK_MANIFEST', ''),
    help='Optional local Parquet manifest produced by build_bulk_photo_manifest.py.',
)
args = parser.parse_args()
args.snapshot = safe_partition(args.snapshot, 'snapshot')
if args.max_locations is not None and args.max_locations < 1:
    raise ValueError('--max-locations must be positive when supplied')
if args.bulk_manifest:
    args.bulk_manifest = os.path.abspath(os.path.expanduser(args.bulk_manifest))
    if not os.path.isfile(args.bulk_manifest):
        raise RuntimeError(f'bulk photo manifest does not exist: {args.bulk_manifest}')

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
FALLBACK_CANDIDATES = max(1, min(12, int(os.getenv('GLOBAL_PHOTO_FALLBACK_CANDIDATES', '9'))))
# This is intentionally only a memory-sized batch. The outer worker drains every
# eligible candidate and has no per-run location cap.
# This is only the in-memory grouping size. It never limits the number of
# locations drained by a run; candidate_batches() continues until the cursor is
# exhausted. The value is intentionally configurable without a hidden 10k cap.
LOCATION_BATCH = max(100, int(os.getenv('GLOBAL_PHOTO_LOCATION_BATCH', '2500')))
RUN_BUDGET_SECONDS = max(60, int(os.getenv('GLOBAL_PHOTO_RUN_BUDGET_SECONDS', str(330 * 60))))
RUN_DEADLINE = time.monotonic() + RUN_BUDGET_SECONDS
CLAIM_CONCURRENCY = max(1, min(64, int(os.getenv('GLOBAL_PHOTO_CLAIM_CONCURRENCY', '32'))))
ATTEMPT_RETRY_DAYS = max(1, min(365, int(os.getenv('GLOBAL_PHOTO_ATTEMPT_RETRY_DAYS', '7'))))
ATTEMPT_RETRY_HOURS = max(1, min(24, int(os.getenv('GLOBAL_PHOTO_ATTEMPT_RETRY_HOURS', '1'))))
CLAIM_LEASE_SECONDS = max(300, min(3600, int(os.getenv('GLOBAL_PHOTO_CLAIM_LEASE_SECONDS', '1200'))))
MAX_BYTES = 10_000_000
MAX_SOURCE_PIXELS = 40_000_000
PROVIDER_CODES = {'wikimedia-commons': 1, 'mapillary': 2, 'kartaview': 3, 'yfcc100m': 4}
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
ATTEMPT_PREFIX = f'{DATA_PREFIX}/enrichment/photo_attempts/snapshot={args.snapshot}'

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
SUPABASE_GATE = threading.BoundedSemaphore(CLAIM_CONCURRENCY)
HTTP_POOL = urllib3.PoolManager(
    num_pools=16,
    maxsize=max(32, min(256, CONCURRENCY + CLAIM_CONCURRENCY)),
    block=True,
    cert_reqs='CERT_REQUIRED',
)


def runtime_exhausted():
    return time.monotonic() >= RUN_DEADLINE


def pooled_json_request(method, url, *, headers, body=None, timeout=30):
    """Read a small JSON response while reusing verified HTTPS connections."""
    response = None
    try:
        response = HTTP_POOL.request(
            method,
            url,
            body=body,
            headers=headers,
            preload_content=False,
            redirect=False,
            retries=False,
            timeout=urllib3.Timeout(connect=min(10, timeout), read=timeout),
        )
        raw = response.read()
        if response.status >= 300:
            raise urllib.error.HTTPError(
                url,
                response.status,
                f'HTTP {response.status}',
                response.headers,
                io.BytesIO(raw),
            )
        return raw
    finally:
        if response is not None:
            response.release_conn()


def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=DATA_BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))


def object_exists(key):
    try:
        data_s3.head_object(Bucket=DATA_BUCKET, Key=key)
        return True
    except ClientError as error:
        code = str(error.response.get('Error', {}).get('Code', ''))
        status = error.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
        if code in {'404', 'NoSuchKey', 'NotFound'} or status == 404:
            return False
        raise


def supabase_rpc(name, payload, retries=6):
    url = f'{SUPABASE_URL}/rest/v1/rpc/{urllib.parse.quote(name)}'
    body = json.dumps(payload, separators=(',', ':')).encode()
    headers = {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}',
        'User-Agent': 'Puddle/1.0 global photo materializer',
    }
    with SUPABASE_GATE:
        for attempt in range(retries):
            try:
                raw = pooled_json_request('POST', url, headers=headers, body=body, timeout=30)
                return json.loads(raw) if raw else None
            except urllib.error.HTTPError as error:
                raw = error.read().decode(errors='replace')[:800]
                if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt + 1 >= retries:
                    raise RuntimeError(f'Supabase RPC {name} failed with {error.code}: {raw}') from error
                retry_after = error.headers.get('Retry-After')
                try:
                    delay = float(retry_after) if retry_after else 0.0
                except ValueError:
                    delay = 0.0
                time.sleep(min(60.0, delay if delay > 0 else min(20, 0.5 * (2 ** attempt))))
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
    external_id = str(row['external_photo_id']).strip()
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


def normalize_source_url(value):
    """Canonicalize an HTTPS source identity without changing image parameters."""
    raw = str(value or '').strip()
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlsplit(raw)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme.lower() != 'https' or not hostname or parsed.username or parsed.password:
        return None
    hostname = hostname.rstrip('.').lower()
    if ':' in hostname and not hostname.startswith('['):
        hostname = f'[{hostname}]'
    netloc = hostname if port in (None, 443) else f'{hostname}:{port}'
    return urllib.parse.urlunsplit(('https', netloc, parsed.path or '/', parsed.query, ''))


def reserve_candidate(row):
    provider = str(row.get('provider') or '')
    provider_code = PROVIDER_CODES.get(provider)
    if not provider_code:
        raise RuntimeError(f'unsupported provider {provider}')
    external_id = str(row.get('external_photo_id') or '').strip()
    if not external_id:
        raise RuntimeError('provider candidate is missing external_photo_id')
    asset = canonical_asset_url(row.get('asset_url')) if provider == 'kartaview' else row.get('asset_url')
    response = supabase_rpc('reserve_global_photo_candidate_v1', {
        'p_location_id': str(row['location_id']),
        'p_provider_code': provider_code,
        'p_provider_asset_id': external_id,
        'p_normalized_source_url': normalize_source_url(asset),
        'p_lease_seconds': CLAIM_LEASE_SECONDS,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise RuntimeError(f'invalid global photo candidate reservation response: {response!r}')
    return response[0]


def bind_candidate_url(reservation_token, source_url):
    normalized = normalize_source_url(source_url)
    if not normalized:
        raise RuntimeError('provider returned an invalid HTTPS asset URL')
    response = supabase_rpc('bind_global_photo_candidate_url_v1', {
        'p_reservation_token': reservation_token,
        'p_normalized_source_url': normalized,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise RuntimeError(f'invalid global photo candidate URL binding response: {response!r}')
    return response[0]


def complete_candidate(reservation_token, status, result=None, content_hash=None, storage_key=None, retry_seconds=3600):
    completed = supabase_rpc('complete_global_photo_candidate_v1', {
        'p_reservation_token': reservation_token,
        'p_status': status,
        'p_result': result,
        'p_content_sha256': content_hash,
        'p_storage_key': storage_key,
        'p_retry_seconds': retry_seconds,
    })
    if completed is not True:
        raise RuntimeError(f'global photo candidate reservation could not be completed as {status}')


def retryable_candidate_error(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in TRANSIENT_HTTP_CODES
    if isinstance(error, (urllib3.exceptions.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError)):
        return True
    return False


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
    url = f'https://graph.mapillary.com/{urllib.parse.quote(str(image_id))}?' + urllib.parse.urlencode({'fields': fields, 'access_token': MAPILLARY_TOKEN})
    for attempt in range(6):
        wait_mapillary_graph_start()
        try:
            row = json.loads(pooled_json_request(
                'GET',
                url,
                headers={
                    'Accept': 'application/json',
                    'User-Agent': 'Puddle/1.0 global photo materializer (https://puddle.you/)',
                },
                timeout=20,
            ))
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
    if provider == 'yfcc100m':
        return host == 'staticflickr.com' or host.endswith('.staticflickr.com')
    return False


def download(url, provider):
    current = str(url or '')
    redirects = 0
    for attempt in range(6):
        parsed = urllib.parse.urlparse(current)
        if parsed.scheme != 'https' or not approved_host(provider, parsed.hostname or ''):
            raise RuntimeError(f'unapproved {provider} asset host')
        gate = WIKIMEDIA_DOWNLOAD_GATE if provider == 'wikimedia-commons' else None
        if gate:
            gate.acquire()
        response = None
        try:
            response = HTTP_POOL.request(
                'GET',
                current,
                headers={
                    'Accept': 'image/avif,image/webp,image/png,image/jpeg',
                    'User-Agent': 'Puddle/1.0 licensed photo materializer (https://puddle.you/)',
                },
                preload_content=False,
                redirect=False,
                retries=False,
                timeout=urllib3.Timeout(connect=10, read=30),
            )
            if 300 <= response.status < 400 and response.headers.get('Location'):
                redirects += 1
                if redirects > 3:
                    raise RuntimeError('too many image redirects')
                current = urllib.parse.urljoin(current, response.headers['Location'])
                response.release_conn()
                response = None
                continue
            if response.status >= 300:
                error_body = response.read(8192)
                raise urllib.error.HTTPError(
                    current,
                    response.status,
                    f'HTTP {response.status}',
                    response.headers,
                    io.BytesIO(error_body),
                )
            content_type = str(response.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            try:
                declared = int(response.headers.get('Content-Length') or 0)
            except ValueError:
                declared = 0
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
        except (urllib3.exceptions.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt >= 5:
                raise
            time.sleep(min(30.0, 0.5 * (2 ** attempt)))
        finally:
            if response is not None:
                response.release_conn()
            if gate:
                gate.release()
    raise RuntimeError(f'{provider} image download exhausted retries')


def read_local_image(path):
    """Read a staged dataset image without creating another worker copy."""
    value = os.path.abspath(os.path.expanduser(str(path or '').strip()))
    if not value or not os.path.isfile(value):
        raise RuntimeError('staged image file is missing')
    with open(value, 'rb') as stream:
        body = stream.read(MAX_BYTES + 1)
    if not body or len(body) > MAX_BYTES:
        raise RuntimeError('staged image is empty or exceeds 10 MB')
    return body

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
        if original.width * original.height > MAX_SOURCE_PIXELS:
            raise RuntimeError('source image has too many pixels')
        image = ImageOps.exif_transpose(original).convert('RGB')
        if image.width > 1600 or image.height > 1000:
            image.thumbnail((1600, 1000), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format='JPEG', quality=84, optimize=True, progressive=True)
        data = out.getvalue()
        if not data or len(data) > MAX_BYTES:
            raise RuntimeError('normalized image is empty or exceeds 10 MB')
        # Fingerprints must describe the exact canonical bytes written to B2.
        # JPEG encoding can change pixels enough to flip a perceptual bit, so
        # calculate both hashes from the encoded representation we serve.
        with Image.open(io.BytesIO(data)) as canonical:
            canonical.load()
            perceptual = dhash(canonical)
            confirmation = average_hash(canonical)
            width, height = canonical.width, canonical.height
        return data, width, height, perceptual, confirmation


def upload_media(data, sha256):
    key = f'{MEDIA_PREFIX}/{sha256[:2]}/{sha256}.jpg'
    try:
        head = s3.head_object(Bucket=MEDIA_BUCKET, Key=key)
        if int(head.get('ContentLength', -1)) == len(data) and head.get('Metadata', {}).get('sha256') == sha256:
            return key
        raise RuntimeError(f'B2 media object exists with mismatched integrity metadata: {key}')
    except ClientError as error:
        code = str(error.response.get('Error', {}).get('Code', ''))
        status = error.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
        if code not in {'404', 'NoSuchKey', 'NotFound'} and status != 404:
            raise
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


def inspect_canonical_media(data):
    """Recover dimensions/fingerprints from an already canonical B2 JPEG."""
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        perceptual = dhash(image)
        confirmation = average_hash(image)
        width, height = image.width, image.height
    return width, height, perceptual, confirmation


def recover_materialized_candidate(row):
    """Close the claim-to-Parquet crash window without redownloading a source."""
    provider_code = PROVIDER_CODES.get(str(row.get('provider') or ''))
    external_id = str(row.get('external_photo_id') or '').strip()
    if not provider_code or not external_id:
        return None
    response = supabase_rpc('get_global_photo_candidate_v1', {
        'p_provider_code': provider_code,
        'p_provider_asset_id': external_id,
    })
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        return None
    record = response[0]
    if str(record.get('candidate_status') or '') != 'accepted':
        return None
    if str(record.get('location_id') or '') != str(row.get('location_id') or ''):
        return None
    content_hash = str(record.get('content_sha256') or '').strip().lower()
    storage_key = str(record.get('storage_key') or '').strip()
    if not re.fullmatch(r'[0-9a-f]{64}', content_hash):
        raise RuntimeError('accepted candidate has an invalid content SHA-256')
    expected_key = f'{MEDIA_PREFIX}/{content_hash[:2]}/{content_hash}.jpg'
    if storage_key != expected_key:
        raise RuntimeError('accepted candidate has a noncanonical B2 storage key')
    response = s3.get_object(Bucket=MEDIA_BUCKET, Key=storage_key)
    body_stream = response['Body']
    try:
        body = body_stream.read(MAX_BYTES + 1)
    finally:
        body_stream.close()
    if not body or len(body) > MAX_BYTES or hashlib.sha256(body).hexdigest() != content_hash:
        raise RuntimeError('accepted candidate B2 bytes failed recovery integrity checks')
    head = s3.head_object(Bucket=MEDIA_BUCKET, Key=storage_key)
    if (
        int(head.get('ContentLength', -1)) != len(body)
        or head.get('Metadata', {}).get('sha256') != content_hash
        or head.get('Metadata', {}).get('purpose') != 'puddle_open_location_photo'
        or str(head.get('ContentType') or '').lower() != 'image/jpeg'
    ):
        raise RuntimeError('accepted candidate B2 metadata failed recovery integrity checks')
    width, height, perceptual, _ = inspect_canonical_media(body)
    candidate = dict(row)
    return {
        'location_id': str(row['location_id']), 'provider': row['provider'], 'external_photo_id': external_id,
        'storage_backend': 'b2', 'storage_key': storage_key, 'content_hash': content_hash,
        'perceptual_hash': perceptual, 'byte_size': len(body), 'width': width, 'height': height,
        'attribution': candidate.get('attribution'), 'attribution_url': candidate.get('page_url'),
        'license': candidate.get('license'), 'license_url': candidate.get('license_url'),
        'source_dataset': candidate.get('source_dataset'),
        'rank_score': float(row.get('rank_score') or 0), 'verified_at': datetime.now(timezone.utc).isoformat(),
    }


def prepare_candidate(row, candidate=None):
    provider = row['provider']
    candidate = dict(candidate or row)
    asset = canonical_asset_url(candidate.get('asset_url')) if provider == 'kartaview' else candidate.get('asset_url')
    body = read_local_image(candidate['image_path']) if candidate.get('image_path') else download(asset, provider)
    normalized, width, height, perceptual, confirmation = normalize(body)
    content_hash = hashlib.sha256(normalized).hexdigest()
    return candidate, normalized, width, height, perceptual, confirmation, content_hash


def materialize_location(candidates):
    location_id = str(candidates[0]['location_id'])
    attempts = []
    for row in candidates:
        candidate_token = None
        try:
            reservation = reserve_candidate(row)
            reservation_status = str(reservation.get('reservation_status') or '')
            if reservation_status != 'reserved':
                if reservation_status == 'seen':
                    recovered = recover_materialized_candidate(row)
                    if recovered:
                        return recovered, {
                            'location_id': location_id, 'status': 'materialized',
                            'recovered': True, 'attempts': attempts, 'winnerRank': row['candidate_rank'],
                        }
                attempts.append({
                    'provider': row['provider'], 'candidateRank': row['candidate_rank'],
                    'preflight': reservation_status,
                    'conflict': reservation.get('conflict_kind') or reservation_status,
                })
                continue
            candidate_token = reservation.get('reservation_token')
            if not candidate_token:
                raise RuntimeError('candidate reservation succeeded without a token')

            candidate = dict(row)
            # Bulk OSV/MSLS rows already carry the staged image and its source
            # identity. Live API Mapillary rows still resolve the current CDN
            # URL through Graph before downloading.
            if row['provider'] == 'mapillary' and not row.get('image_path'):
                candidate.update(mapillary_details(row['external_photo_id']))
                binding = bind_candidate_url(candidate_token, candidate.get('asset_url'))
                binding_status = str(binding.get('bind_status') or '')
                if binding_status != 'bound':
                    attempts.append({
                        'provider': row['provider'], 'candidateRank': row['candidate_rank'],
                        'preflight': binding_status,
                        'conflict': binding.get('conflict_kind') or binding_status,
                    })
                    candidate_token = None
                    continue

            candidate, normalized, width, height, perceptual, confirmation, content_hash = prepare_candidate(row, candidate)
            claim = claim_photo(row, content_hash, perceptual, confirmation)
            claim_status = claim.get('claim_status')
            conflict_kind = claim.get('conflict_kind')
            if claim_status != 'claimed':
                candidate_status = 'available' if conflict_kind == 'location_has_photo' else 'duplicate'
                try:
                    complete_candidate(
                        candidate_token, candidate_status, conflict_kind or claim_status,
                        content_hash=content_hash, retry_seconds=0 if candidate_status == 'available' else 3600,
                    )
                finally:
                    candidate_token = None
                attempts.append({'provider': row['provider'], 'candidateRank': row['candidate_rank'], 'conflict': conflict_kind or claim_status})
                if conflict_kind == 'location_has_photo':
                    return None, {'location_id': location_id, 'status': 'already_claimed', 'attempts': attempts}
                continue
            photo_claim_token = claim.get('claim_token')
            if not photo_claim_token:
                raise RuntimeError('claim succeeded without a token')
            try:
                key = upload_media(normalized, content_hash)
                finalize_claim(photo_claim_token, key)
            except Exception:
                release_claim(photo_claim_token)
                raise
            try:
                complete_candidate(candidate_token, 'accepted', 'materialized', content_hash=content_hash, storage_key=key)
            except Exception as error:
                # The authoritative photo claim and immutable B2 object are
                # already complete. A later reservation reconciles this row
                # from global_photo_claims without downloading the asset again.
                print(f'warning: candidate registry completion failed for {row["provider"]}/{row["external_photo_id"]}: {error}', flush=True)
            candidate_token = None
            return {
                'location_id': location_id, 'provider': row['provider'], 'external_photo_id': row['external_photo_id'],
                'storage_backend': 'b2', 'storage_key': key, 'content_hash': content_hash, 'perceptual_hash': perceptual,
                'byte_size': len(normalized), 'width': width, 'height': height, 'attribution': candidate.get('attribution'),
                'attribution_url': candidate.get('page_url'), 'license': candidate.get('license'), 'license_url': candidate.get('license_url'),
                'source_dataset': candidate.get('source_dataset'),
                'rank_score': float(row.get('rank_score') or 0), 'verified_at': datetime.now(timezone.utc).isoformat()
            }, {'location_id': location_id, 'status': 'materialized', 'attempts': attempts, 'winnerRank': row['candidate_rank']}
        except Exception as error:
            retryable = retryable_candidate_error(error)
            if candidate_token:
                try:
                    complete_candidate(
                        candidate_token,
                        'available' if retryable else 'invalid',
                        str(error)[:240],
                        retry_seconds=3600 if retryable else 0,
                    )
                except Exception as completion_error:
                    print(f'warning: candidate registry error handling failed for {row["provider"]}/{row["external_photo_id"]}: {completion_error}', flush=True)
            attempts.append({
                'provider': row['provider'],
                'candidateRank': row['candidate_rank'],
                'error': str(error)[:240],
                'retryable': retryable,
            })
    if any(attempt.get('retryable') for attempt in attempts):
        status = 'retryable_error'
    elif any(attempt.get('error') for attempt in attempts):
        status = 'invalid'
    else:
        status = 'exhausted'
    return None, {'location_id': location_id, 'status': status, 'attempts': attempts}


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
B2_SECRET_SQL = f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);"""
con.execute(B2_SECRET_SQL)


def countries():
    if args.countries.strip():
        return sorted({safe_partition(v.strip().upper(), 'country') for v in args.countries.split(',') if v.strip()})
    if args.bulk_manifest:
        manifest = args.bulk_manifest.replace("'", "''")
        return [
            safe_partition(r[0], 'country')
            for r in con.execute(
                f"SELECT DISTINCT upper(trim(cast(country_code AS VARCHAR))) FROM read_parquet('{manifest}', union_by_name=true) ORDER BY 1"
            ).fetchall()
            if r[0]
        ]
    glob = f's3://{DATA_BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    return [safe_partition(r[0], 'country') for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}',hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]


def candidate_batches(query, location_limit=None):
    """Build one country queue, then drain it in uncapped cursor batches.

    The eligible queue is materialized once so every subsequent batch reads
    local DuckDB state instead of repeatedly rescanning remote Parquet files.
    Ranking is applied only to the current location batch, which avoids the
    unbounded global window that previously hid progress for hours.
    """
    columns = [
        'location_id', 'provider', 'external_photo_id', 'image_path', 'asset_url',
        'page_url', 'attribution', 'license', 'license_url', 'source_dataset',
        'dataset_priority', 'distance_m', 'rank_score', 'candidate_rank',
    ]
    con.execute('DROP TABLE IF EXISTS photo_candidate_queue')
    queue_started = time.monotonic()
    emitted_locations = 0
    try:
        con.execute(f'CREATE TEMP TABLE photo_candidate_queue AS {query}')
        queue_stats = con.execute('SELECT count(*), count(DISTINCT location_id) FROM photo_candidate_queue').fetchone()
        print(f'photo candidate queue ready: {queue_stats[1]} locations, {queue_stats[0]} candidates in {time.monotonic() - queue_started:.1f}s', flush=True)
        location_cursor = ''
        while not runtime_exhausted():
            if location_limit is not None and emitted_locations >= location_limit:
                break
            batch_limit = LOCATION_BATCH
            if location_limit is not None:
                batch_limit = min(batch_limit, location_limit - emitted_locations)
            escaped_cursor = location_cursor.replace("'", "''")
            batch_query = f"""
              WITH target_locations AS (
                SELECT location_id
                FROM photo_candidate_queue
                WHERE location_id > '{escaped_cursor}'
                GROUP BY location_id
                ORDER BY location_id
                LIMIT {batch_limit}
              ), ranked AS (
                SELECT q.*,
                       row_number() OVER (
                         PARTITION BY q.location_id
                           ORDER BY q.provider_rank,coalesce(q.rank_score,0) DESC,
                                    coalesce(q.dataset_priority,99),coalesce(q.distance_m,1e18),q.external_photo_id
                       ) candidate_rank
                FROM photo_candidate_queue q
                JOIN target_locations t ON t.location_id=q.location_id
              )
              SELECT location_id,provider,external_photo_id,image_path,asset_url,page_url,attribution,license,license_url,
                     source_dataset,dataset_priority,distance_m,rank_score,candidate_rank
              FROM ranked
              WHERE candidate_rank <= {FALLBACK_CANDIDATES}
              ORDER BY location_id,candidate_rank
            """
            rows = con.execute(batch_query).fetchall()
            if not rows:
                break
            grouped = {}
            current_location_id = None
            current_candidates = []
            for row in rows:
                item = dict(zip(columns, row))
                location_id = str(item['location_id'])
                if current_location_id is not None and location_id != current_location_id:
                    grouped[current_location_id] = current_candidates
                    if len(grouped) >= LOCATION_BATCH:
                        yield grouped
                        grouped = {}
                    current_candidates = []
                current_location_id = location_id
                current_candidates.append(item)
            if current_location_id is not None:
                grouped[current_location_id] = current_candidates
            if not grouped:
                break
            next_cursor = max(grouped)
            if next_cursor <= location_cursor:
                raise RuntimeError('photo candidate cursor did not advance')
            print(f'photo candidate batch ready: {len(grouped)} locations after {next_cursor}', flush=True)
            emitted_locations += len(grouped)
            yield grouped
            location_cursor = next_cursor
    finally:
        con.execute('DROP TABLE IF EXISTS photo_candidate_queue')


def write_results(country, results):
    if not results:
        return
    con.execute('DROP TABLE IF EXISTS materialized_results')
    con.execute('CREATE TEMP TABLE materialized_results(location_id VARCHAR,provider VARCHAR,external_photo_id VARCHAR,storage_backend VARCHAR,storage_key VARCHAR,content_hash VARCHAR,perceptual_hash VARCHAR,byte_size BIGINT,width INTEGER,height INTEGER,attribution VARCHAR,attribution_url VARCHAR,license VARCHAR,license_url VARCHAR,source_dataset VARCHAR,rank_score DOUBLE,verified_at VARCHAR)')
    keys = ['location_id', 'provider', 'external_photo_id', 'storage_backend', 'storage_key', 'content_hash', 'perceptual_hash', 'byte_size', 'width', 'height', 'attribution', 'attribution_url', 'license', 'license_url', 'source_dataset', 'rank_score', 'verified_at']
    con.executemany('INSERT INTO materialized_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [tuple(r[k] for k in keys) for r in results])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out = f's3://{DATA_BUCKET}/{DATA_PREFIX}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}/part-{stamp}.parquet'
    con.execute(f"COPY materialized_results TO '{out}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000)")


def write_attempts(country, diagnostics):
    # Successful locations are already durable in photo_metadata and do not
    # need a second state record. Keeping only non-success outcomes bounds the
    # ledger and makes subsequent scans cheaper; permanent invalid assets use
    # the long retry window instead of occupying the hourly retry path.
    diagnostics = [detail for detail in diagnostics if detail.get('status') != 'materialized']
    if not diagnostics:
        return
    attempted_at = datetime.now(timezone.utc)
    rows = []
    for detail in diagnostics:
        status = str(detail.get('status') or 'worker_error')
        if status in {'exhausted', 'invalid'}:
            retry_at = attempted_at + timedelta(days=ATTEMPT_RETRY_DAYS)
        else:
            retry_at = attempted_at + timedelta(hours=ATTEMPT_RETRY_HOURS)
        rows.append((
            str(detail.get('location_id') or ''), status, attempted_at, retry_at,
            len(detail.get('attempts') or []),
            json.dumps(detail, separators=(',', ':'), ensure_ascii=False)[:4000],
        ))
    con.execute('DROP TABLE IF EXISTS photo_attempt_results')
    con.execute('CREATE TEMP TABLE photo_attempt_results(location_id VARCHAR,status VARCHAR,attempted_at TIMESTAMPTZ,retry_at TIMESTAMPTZ,candidate_count INTEGER,details VARCHAR)')
    con.executemany('INSERT INTO photo_attempt_results VALUES (?,?,?,?,?,?)', rows)
    stamp = attempted_at.strftime('%Y%m%dT%H%M%S%fZ')
    out = f's3://{DATA_BUCKET}/{ATTEMPT_PREFIX}/country_code={country}/part-{stamp}.parquet'
    con.execute(f"COPY photo_attempt_results TO '{out}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000)")


# Fail closed before doing provider work if the uniqueness RPCs/migration are not live.
cleanup_expired_claims()
if prefix_exists(EXCLUSION_PREFIX):
    exclusion_sql = f"SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('s3://{DATA_BUCKET}/{EXCLUSION_PREFIX}/*.parquet',union_by_name=true)"
else:
    exclusion_sql = 'SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false'

stop_requested = False
batches_processed = 0
locations_seen = 0
materialized_total = 0
for country in countries():
    if runtime_exhausted():
        stop_requested = True
        break
    country_location_limit = None
    if args.max_locations is not None:
        country_location_limit = max(0, args.max_locations - locations_seen)
        if country_location_limit == 0:
            break
    map_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=mapillary/snapshot={args.snapshot}/country_code={country}'
    wiki_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=wikimedia-commons/snapshot={args.snapshot}/country_code={country}'
    karta_prefix = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=kartaview/snapshot={args.snapshot}/country_code={country}'
    sources = []
    if args.bulk_manifest:
        manifest = args.bulk_manifest.replace("'", "''")
        sources.append(
            f"SELECT cast(location_id AS VARCHAR) location_id,provider,external_photo_id,image_path,asset_url,page_url,"
            f"attribution,license,license_url,source_dataset,cast(dataset_priority AS INTEGER) dataset_priority,"
            f"cast(distance_m AS DOUBLE) distance_m,cast(rank_score AS DOUBLE) rank_score "
            f"FROM read_parquet('{manifest}', union_by_name=true) "
            f"WHERE upper(trim(cast(country_code AS VARCHAR)))='{country}'"
        )
    else:
        if prefix_exists(map_prefix):
            sources.append(f"SELECT location_id,provider,external_photo_id,NULL::VARCHAR image_path,NULL::VARCHAR asset_url,NULL::VARCHAR page_url,NULL::VARCHAR attribution,NULL::VARCHAR license,NULL::VARCHAR license_url,NULL::VARCHAR source_dataset,NULL::INTEGER dataset_priority,NULL::DOUBLE distance_m,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{map_prefix}/candidates.parquet')")
        if prefix_exists(wiki_prefix):
            sources.append(f"SELECT location_id,provider,external_photo_id,NULL::VARCHAR image_path,asset_url,page_url,attribution,license,license_url,NULL::VARCHAR source_dataset,NULL::INTEGER dataset_priority,NULL::DOUBLE distance_m,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{wiki_prefix}/candidates.parquet')")
        if prefix_exists(karta_prefix):
            sources.append(f"SELECT location_id,provider,external_photo_id,NULL::VARCHAR image_path,asset_url,page_url,attribution,license,license_url,NULL::VARCHAR source_dataset,NULL::INTEGER dataset_priority,NULL::DOUBLE distance_m,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{karta_prefix}/candidates.parquet')")
    if not sources:
        continue
    union = ' UNION ALL '.join(sources)
    loc = f"s3://{DATA_BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet"
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
    existing_sql = ' UNION ALL '.join(existing_sources) if existing_sources else 'SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false'
    attempt_prefix = f'{ATTEMPT_PREFIX}/country_code={country}'
    if prefix_exists(attempt_prefix):
        attempt_uri = f's3://{DATA_BUCKET}/{attempt_prefix}/*.parquet'
        recent_attempts_sql = f"""
          SELECT location_id FROM (
            SELECT cast(location_id AS VARCHAR) location_id,
                   cast(status AS VARCHAR) status,
                   try_cast(retry_at AS TIMESTAMPTZ) retry_at,
                   row_number() OVER (
                     PARTITION BY cast(location_id AS VARCHAR)
                     ORDER BY try_cast(attempted_at AS TIMESTAMPTZ) DESC NULLS LAST
                   ) attempt_rank
            FROM read_parquet('{attempt_uri}', union_by_name=true)
          ) latest
          WHERE attempt_rank=1
            AND status <> 'materialized'
            AND retry_at > current_timestamp
        """
    else:
        recent_attempts_sql = 'SELECT NULL::VARCHAR location_id WHERE false'

    query = f"""
          WITH all_candidates AS ({union}),
          photo_exclusions AS ({exclusion_sql}),
          raw_existing_photos AS ({existing_sql}),
          existing_photos AS (
            SELECT DISTINCT e.location_id
            FROM raw_existing_photos e
            WHERE NOT EXISTS (
              SELECT 1 FROM photo_exclusions x
              WHERE x.location_id=e.location_id AND x.content_hash=e.content_hash
            )
          ),
          recent_photo_attempts AS ({recent_attempts_sql}),
          l AS (SELECT cast(id AS VARCHAR) location_id,category FROM read_parquet('{loc}')),
          eligible_candidates AS (
            SELECT cast(c.location_id AS VARCHAR) location_id,c.provider,c.external_photo_id,c.image_path,c.asset_url,c.page_url,c.attribution,c.license,c.license_url,
              c.source_dataset,c.dataset_priority,c.distance_m,c.rank_score,
              CASE WHEN l.category IN ('park','museum','gallery','attraction','scenic_spot')
                   THEN CASE c.provider WHEN 'wikimedia-commons' THEN 0 WHEN 'mapillary' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END
                   ELSE CASE c.provider WHEN 'mapillary' THEN 0 WHEN 'wikimedia-commons' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END END provider_rank
            FROM all_candidates c
            JOIN l ON l.location_id=cast(c.location_id AS VARCHAR)
            WHERE NOT EXISTS (SELECT 1 FROM existing_photos e WHERE e.location_id=cast(c.location_id AS VARCHAR))
              AND NOT EXISTS (SELECT 1 FROM recent_photo_attempts a WHERE a.location_id=cast(c.location_id AS VARCHAR))
          )
          SELECT location_id,provider,external_photo_id,image_path,asset_url,page_url,attribution,license,license_url,
                 source_dataset,dataset_priority,distance_m,rank_score,provider_rank
          FROM eligible_candidates
        """
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for grouped in candidate_batches(query, country_location_limit):
            if runtime_exhausted():
                stop_requested = True
                break
            batch_started = time.monotonic()
            target_ids = sorted(grouped)
            locations_seen += len(target_ids)

            results = []
            diagnostics = []
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
            write_attempts(country, diagnostics)
            batches_processed += 1
            materialized_total += len(results)
            exhausted = sum(1 for row in diagnostics if row.get('status') == 'exhausted')
            retryable_errors = sum(1 for row in diagnostics if row.get('status') in {'retryable_error', 'worker_error'})
            already_claimed = sum(1 for row in diagnostics if row.get('status') == 'already_claimed')
            elapsed_seconds = max(time.monotonic() - batch_started, 0.001)
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
                'retryableErrors': retryable_errors,
                'batchSize': LOCATION_BATCH,
                'elapsedSeconds': round(elapsed_seconds, 1),
                'photosPerMinute': round(len(results) * 60 / elapsed_seconds, 2),
                'locationsPerMinute': round(len(target_ids) * 60 / elapsed_seconds, 2),
                'failureSamples': failure_samples,
            }, indent=2), flush=True)
            if runtime_exhausted():
                stop_requested = True
                break
        if stop_requested:
            break

    if stop_requested:
        break

print(json.dumps({
    'provider': 'global-photo-materializer',
    'snapshot': args.snapshot,
    'complete': not stop_requested,
    'runBudgetSeconds': RUN_BUDGET_SECONDS,
    'runtimeBudgetExhausted': runtime_exhausted(),
    'batchesProcessed': batches_processed,
    'locationsSeen': locations_seen,
    'materialized': materialized_total,
    'maxLocations': args.max_locations,
    'bulkManifest': args.bulk_manifest or None,
}, indent=2), flush=True)
