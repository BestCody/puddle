#!/usr/bin/env python3
"""Use the full authenticated KartaView quota as a global photo fallback.

Successful no-match lookups are persisted in B2 so the 1,000 requests/hour
allowance continuously advances to new locations instead of retrying the same
places. Candidate files are merged, not overwritten, and transient failures are
left unattempted so a later run can retry them.
"""
import argparse
import concurrent.futures
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config
from botocore.exceptions import ClientError
from kartaview_urls import asset_url


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
parser.add_argument('--limit', type=int, default=int(os.getenv('KARTAVIEW_REQUEST_LIMIT', '1000')))
args = parser.parse_args()
args.snapshot = safe_partition(args.snapshot, 'snapshot')

TOKEN = os.getenv('KARTAVIEW_ACCESS_TOKEN', '').strip()
BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not ENDPOINT_URL or not KEY_ID or not KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')

PROVIDER_HOURLY_MAX = 1000 if TOKEN else 100
REQUESTS_PER_HOUR = max(1, min(PROVIDER_HOURLY_MAX, int(os.getenv('KARTAVIEW_REQUESTS_PER_HOUR', str(PROVIDER_HOURLY_MAX)))))
START_INTERVAL = 3600.0 / REQUESTS_PER_HOUR
CONCURRENCY = max(1, min(8, int(os.getenv('KARTAVIEW_MAX_CONCURRENCY', '4'))))
MAX_DISTANCE_M = float(os.getenv('KARTAVIEW_MAX_DISTANCE_M', '45'))
MAX_HEADING_ERROR = float(os.getenv('KARTAVIEW_MAX_HEADING_ERROR', '110'))
LIMIT = max(1, min(PROVIDER_HOURLY_MAX, args.limit))
MAX_CANDIDATES = max(1, min(10, int(os.getenv('OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER', '3'))))
RECHECK_DAYS = max(1, min(365, int(os.getenv('KARTAVIEW_RECHECK_DAYS', '30'))))
RUN_BUDGET_SECONDS = max(60, int(os.getenv('KARTAVIEW_RUN_BUDGET_SECONDS', str(65 * 60))))
RUN_DEADLINE = time.monotonic() + RUN_BUDGET_SECONDS
CHECKPOINT_EVERY = max(10, min(250, int(os.getenv('KARTAVIEW_CHECKPOINT_EVERY', '100'))))

data_s3 = boto3.client(
    's3', endpoint_url=ENDPOINT_URL, aws_access_key_id=KEY_ID, aws_secret_access_key=KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=64),
)


def object_exists(key):
    try:
        data_s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError as error:
        code = str(error.response.get('Error', {}).get('Code', ''))
        if code in {'404', 'NoSuchKey', 'NotFound'}:
            return False
        raise


def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))


class RequestBudget:
    def __init__(self, limit):
        self.limit = max(0, int(limit))
        self.used = 0
        self.lock = threading.Lock()

    def claim(self):
        with self.lock:
            if self.used >= self.limit:
                return False
            self.used += 1
            return True

    def release(self):
        with self.lock:
            self.used = max(0, self.used - 1)


class RateGate:
    def __init__(self, interval):
        self.interval = interval
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.paused_until = 0.0

    def wait(self, deadline=None):
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_at, self.paused_until)
            self.next_at = start + self.interval
        if deadline is not None and start >= deadline:
            return False
        if start > now:
            time.sleep(start - now)
        return deadline is None or time.monotonic() < deadline

    def defer(self, seconds):
        with self.lock:
            self.paused_until = max(self.paused_until, time.monotonic() + max(0.0, seconds))


budget = RequestBudget(LIMIT)
gate = RateGate(START_INTERVAL)


def runtime_exhausted():
    return time.monotonic() >= RUN_DEADLINE


def rows_from_payload(payload):
    candidates = [
        (payload.get('result') or {}).get('data'),
        (payload.get('result') or {}).get('currentPageItems'),
        payload.get('result'), payload.get('data'), payload.get('currentPageItems')
    ]
    return next((value for value in candidates if isinstance(value, list)), [])


def finite(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def request_location(row):
    params = {
        'lat': str(row['latitude']), 'lng': str(row['longitude']), 'radius': '45', 'zoomLevel': '18',
        'join': 'sequence', 'orderBy': 'id', 'orderDirection': 'desc'
    }
    if TOKEN:
        params['access_token'] = TOKEN
    url = 'https://api.openstreetcam.org/2.0/photo/?' + urllib.parse.urlencode(params)
    for attempt in range(6):
        if runtime_exhausted():
            return row, [], False, 'runtime_budget_exhausted'
        if not budget.claim():
            return row, [], False, 'budget_exhausted'
        if not gate.wait(RUN_DEADLINE):
            budget.release()
            return row, [], False, 'runtime_budget_exhausted'
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Puddle/1.0 global KartaView fallback indexer (https://puddle.you/)'})
            with urllib.request.urlopen(req, timeout=25) as response:
                payload = json.load(response)
            return row, rows_from_payload(payload), True, None
        except urllib.error.HTTPError as error:
            if runtime_exhausted():
                return row, [], False, 'runtime_budget_exhausted'
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5:
                return row, [], False, f'HTTP {error.code}'
            retry = error.headers.get('Retry-After')
            gate.defer(float(retry) if retry and retry.isdigit() else min(60, 1.0 * (2 ** attempt)))
        except Exception as error:
            if runtime_exhausted():
                return row, [], False, 'runtime_budget_exhausted'
            if attempt == 5:
                return row, [], False, str(error)[:200]
            gate.defer(min(20, 1.0 * (2 ** attempt)))
    return row, [], False, 'request_failed'


def haversine(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dlat, dlon = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    value = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0, 1 - value)))


def bearing(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dlon = math.radians(b_lon - a_lon)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angle(a, b):
    return abs(((a - b + 540) % 360) - 180)


def score(location, image):
    lat = finite(image.get('lat') or image.get('latitude') or (image.get('gps') or {}).get('lat'))
    lon = finite(image.get('lng') or image.get('lon') or image.get('longitude') or (image.get('gps') or {}).get('lng'))
    if lat is None or lon is None:
        return None
    distance = haversine(location['latitude'], location['longitude'], lat, lon)
    if distance > MAX_DISTANCE_M:
        return None
    heading = finite(image.get('heading') or image.get('compassAngle') or (image.get('sequence') or {}).get('heading'))
    target = bearing(lat, lon, location['latitude'], location['longitude'])
    heading_error = angle(heading, target) if heading is not None else None
    if heading_error is not None and heading_error > MAX_HEADING_ERROR:
        return None
    distance_score = 1 - min(1, distance / MAX_DISTANCE_M)
    heading_score = 0.55 if heading_error is None else 1 - min(1, heading_error / MAX_HEADING_ERROR)
    return 0.78 + (distance_score * 0.55 + heading_score * 0.30 + 0.15) * 0.22, distance, heading_error


def countries(con):
    if args.countries.strip():
        return sorted({safe_partition(v.strip().upper(), 'country') for v in args.countries.split(',') if v.strip()})
    glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    return [safe_partition(r[0], 'country') for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]


def merge_attempts(con, country, attempted):
    if not attempted:
        return
    key = f'{DATA_PREFIX}/enrichment/photo_attempts/provider=kartaview/snapshot={args.snapshot}/country_code={country}/attempts.parquet'
    path = f's3://{BUCKET}/{key}'
    con.execute('DROP TABLE IF EXISTS new_kartaview_attempts')
    con.execute('CREATE TEMP TABLE new_kartaview_attempts(location_id VARCHAR, attempted_at VARCHAR)')
    stamp = datetime.now(timezone.utc).isoformat()
    con.executemany('INSERT INTO new_kartaview_attempts VALUES (?,?)', [(location_id, stamp) for location_id in attempted])
    if object_exists(key):
        con.execute('DROP TABLE IF EXISTS all_kartaview_attempts')
        con.execute(f"""
          CREATE TEMP TABLE all_kartaview_attempts AS
          SELECT * FROM read_parquet('{path}')
          UNION ALL BY NAME
          SELECT * FROM new_kartaview_attempts
        """)
    else:
        con.execute('DROP TABLE IF EXISTS all_kartaview_attempts')
        con.execute('CREATE TEMP TABLE all_kartaview_attempts AS SELECT * FROM new_kartaview_attempts')
    con.execute(f"""
      COPY (
        SELECT location_id, max(attempted_at) attempted_at
        FROM all_kartaview_attempts GROUP BY location_id
      ) TO '{path}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000,OVERWRITE_OR_IGNORE true)
    """)


def merge_candidates(con, country, candidates):
    if not candidates:
        return 0
    key = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=kartaview/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
    path = f's3://{BUCKET}/{key}'
    con.execute('DROP TABLE IF EXISTS new_kartaview_candidates')
    con.execute('CREATE TEMP TABLE new_kartaview_candidates(location_id VARCHAR,provider VARCHAR,external_photo_id VARCHAR,asset_url VARCHAR,page_url VARCHAR,attribution VARCHAR,license VARCHAR,license_url VARCHAR,distance_m DOUBLE,heading_error DOUBLE,rank_score DOUBLE)')
    con.executemany('INSERT INTO new_kartaview_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?)', candidates)
    if object_exists(key):
        con.execute('DROP TABLE IF EXISTS all_kartaview_candidates')
        con.execute(f"""
          CREATE TEMP TABLE all_kartaview_candidates AS
          SELECT * FROM read_parquet('{path}')
          UNION ALL BY NAME
          SELECT * FROM new_kartaview_candidates
        """)
    else:
        con.execute('DROP TABLE IF EXISTS all_kartaview_candidates')
        con.execute('CREATE TEMP TABLE all_kartaview_candidates AS SELECT * FROM new_kartaview_candidates')
    con.execute(f"""
      COPY (
        WITH dedup AS (
          SELECT *, row_number() OVER (
            PARTITION BY location_id, external_photo_id
            ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
          ) duplicate_rank
          FROM all_kartaview_candidates
        ), ranked AS (
          SELECT * EXCLUDE duplicate_rank,
                 row_number() OVER (
                   PARTITION BY location_id
                   ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
                 ) location_rank
          FROM dedup WHERE duplicate_rank=1
        )
        SELECT * EXCLUDE location_rank FROM ranked WHERE location_rank<={MAX_CANDIDATES}
      ) TO '{path}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000,OVERWRITE_OR_IGNORE true)
    """)
    return len(candidates)


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{KEY_ID.replace("'","''")}',SECRET '{KEY.replace("'","''")}',REGION '{REGION.replace("'","''")}',ENDPOINT '{ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")

remaining_locations = LIMIT
summaries = []
stop_requested = False
for country in countries(con):
    if runtime_exhausted() or budget.used >= budget.limit or remaining_locations <= 0:
        break

    loc = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
    existing = []
    bootstrap_prefix = f'{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}'
    if object_exists(f'{bootstrap_prefix}/photo_metadata.parquet'):
        existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{bootstrap_prefix}/photo_metadata.parquet')")
    for provider in ('wikimedia-commons', 'mapillary', 'kartaview'):
        key = f'{DATA_PREFIX}/enrichment/photo_candidates/provider={provider}/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
        if object_exists(key):
            existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{key}')")
    photo_prefix = f'{DATA_PREFIX}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}'
    if prefix_exists(photo_prefix):
        existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{photo_prefix}/*.parquet', union_by_name=true)")
    attempt_key = f'{DATA_PREFIX}/enrichment/photo_attempts/provider=kartaview/snapshot={args.snapshot}/country_code={country}/attempts.parquet'
    if object_exists(attempt_key):
        existing.append(
            f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{attempt_key}') "
            f"WHERE try_cast(attempted_at AS TIMESTAMP) >= current_timestamp - INTERVAL {RECHECK_DAYS} DAY"
        )

    if existing:
        con.execute(f"CREATE OR REPLACE TEMP VIEW occupied AS {' UNION ALL '.join(existing)}")
    else:
        con.execute('CREATE OR REPLACE TEMP VIEW occupied AS SELECT NULL::VARCHAR location_id WHERE false')

    select_limit = min(remaining_locations, budget.limit - budget.used)
    requested = con.execute(f"""
      SELECT id location_id, latitude, longitude
      FROM read_parquet('{loc}') l
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM occupied o WHERE o.location_id=l.id)
      ORDER BY id
      LIMIT {select_limit}
    """).fetchall()
    locations = [{'location_id': str(row[0]), 'latitude': float(row[1]), 'longitude': float(row[2])} for row in requested]
    if not locations:
        continue

    print(f'{country}: spending up to {budget.limit - budget.used} remaining KartaView request starts at {REQUESTS_PER_HOUR}/hour')
    candidates = []
    attempted = []
    attempted_since_checkpoint = []
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for location, images, success, error in pool.map(request_location, locations, chunksize=1):
            if not success:
                failures.append({'location_id': location['location_id'], 'error': error})
                if error in {'runtime_budget_exhausted', 'budget_exhausted'}:
                    stop_requested = True
                continue
            attempted.append(location['location_id'])
            attempted_since_checkpoint.append(location['location_id'])
            if len(attempted_since_checkpoint) >= CHECKPOINT_EVERY:
                merge_attempts(con, country, attempted_since_checkpoint)
                attempted_since_checkpoint = []
            ranked = []
            for image in images:
                measured = score(location, image)
                url = asset_url(image)
                external = image.get('id') or image.get('photoId')
                if not measured or not url or not external:
                    continue
                value, distance, heading_error = measured
                sequence = image.get('sequenceId') or (image.get('sequence') or {}).get('id') or ''
                ranked.append((
                    value, str(external), url,
                    f'https://kartaview.org/details/{urllib.parse.quote(str(sequence))}/{urllib.parse.quote(str(external))}/track-info',
                    distance, heading_error
                ))
            ranked.sort(reverse=True)
            for value, external, url, page_url, distance, heading_error in ranked[:MAX_CANDIDATES]:
                candidates.append((
                    location['location_id'], 'kartaview', external, url, page_url,
                    'KartaView contributors · CC BY-SA 4.0', 'CC-BY-SA-4.0',
                    'https://creativecommons.org/licenses/by-sa/4.0/', distance, heading_error, value
                ))

    merge_attempts(con, country, attempted_since_checkpoint)
    candidate_count = merge_candidates(con, country, candidates)
    remaining_locations -= len(attempted)
    summaries.append({
        'country': country,
        'selected': len(locations),
        'attempted': len(attempted),
        'candidates': candidate_count,
        'failures': failures[:10],
    })
    if stop_requested:
        break

print(json.dumps({
    'provider': 'kartaview',
    'snapshot': args.snapshot,
    'authenticated': bool(TOKEN),
    'requests': budget.used,
    'requestLimit': LIMIT,
    'requestsPerHour': REQUESTS_PER_HOUR,
    'maxConcurrency': CONCURRENCY,
    'runBudgetSeconds': RUN_BUDGET_SECONDS,
    'runtimeBudgetExhausted': runtime_exhausted(),
    'checkpointEvery': CHECKPOINT_EVERY,
    'stoppedReason': 'runtime_budget_exhausted' if runtime_exhausted() else ('request_budget_exhausted' if budget.used >= budget.limit else None),
    'countries': summaries,
}, indent=2))
