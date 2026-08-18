#!/usr/bin/env python3
"""Build Wikimedia Commons candidates with resumable, quota-saturating cell scans.

The worker keeps at most three requests in flight, starts requests at the
configured Wikimedia entitlement, checkpoints completed geographic cells in B2,
and merges partial candidate results so repeated scheduled runs always advance
coverage instead of restarting from the first country.
"""
import argparse
import concurrent.futures
import hashlib
import html
import json
import math
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
parser.add_argument('--request-limit', type=int, default=None)
args = parser.parse_args()

BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
B2_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
B2_ENDPOINT = B2_ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
B2_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
B2_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
B2_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not B2_ENDPOINT or not B2_KEY_ID or not B2_KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')

BASE_CELL = max(0.01, min(0.1, float(os.getenv('WIKIMEDIA_CELL_DEGREES', '0.05'))))
MIN_CELL = max(0.003, min(BASE_CELL, float(os.getenv('WIKIMEDIA_MIN_CELL_DEGREES', '0.00625'))))
REQUESTS_PER_MINUTE = max(1, min(2000, int(os.getenv('WIKIMEDIA_REQUESTS_PER_MINUTE', '200'))))
MIN_INTERVAL = 60.0 / REQUESTS_PER_MINUTE
CONCURRENCY = max(1, min(3, int(os.getenv('WIKIMEDIA_MAX_CONCURRENCY', '3'))))
ACCESS_TOKEN = os.getenv('WIKIMEDIA_ACCESS_TOKEN', '').strip()
MAX_CANDIDATES = max(1, min(10, int(os.getenv('OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER', '3'))))
USER_AGENT = os.getenv('WIKIMEDIA_USER_AGENT', 'Puddle/1.0 global location photo indexer (https://puddle.you/)')
DEFAULT_REQUEST_LIMIT = REQUESTS_PER_MINUTE * 350
REQUEST_LIMIT = max(1, min(REQUESTS_PER_MINUTE * 360, int(args.request_limit or os.getenv('WIKIMEDIA_REQUEST_LIMIT', DEFAULT_REQUEST_LIMIT))))
SCOPE = 'all' if not args.countries.strip() else hashlib.sha1(args.countries.strip().upper().encode()).hexdigest()[:12]
STATE_PREFIX = f'{DATA_PREFIX}/enrichment/photo_state/provider=wikimedia-commons/snapshot={args.snapshot}/scope={SCOPE}'
REFRESH_DAYS = max(1, min(365, int(os.getenv('WIKIMEDIA_RESCAN_DAYS', '30'))))

s3 = boto3.client(
    's3',
    endpoint_url=B2_ENDPOINT_URL,
    aws_access_key_id=B2_KEY_ID,
    aws_secret_access_key=B2_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=64),
)


def load_json(key, default):
    try:
        body = s3.get_object(Bucket=BUCKET, Key=key)['Body'].read()
        return json.loads(body)
    except ClientError as error:
        code = str(error.response.get('Error', {}).get('Code', ''))
        if code in {'404', 'NoSuchKey', 'NotFound'}:
            return default
        raise


def save_json(key, value):
    payload = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    s3.put_object(Bucket=BUCKET, Key=key, Body=payload, ContentType='application/json', CacheControl='no-store')


def object_exists(key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError as error:
        code = str(error.response.get('Error', {}).get('Code', ''))
        if code in {'404', 'NoSuchKey', 'NotFound'}:
            return False
        raise


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


class RateGate:
    def __init__(self, interval):
        self.interval = interval
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.paused_until = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_at, self.paused_until)
            self.next_at = start + self.interval
        if start > now:
            time.sleep(start - now)

    def defer(self, seconds):
        with self.lock:
            self.paused_until = max(self.paused_until, time.monotonic() + max(0.0, seconds))


budget = RequestBudget(REQUEST_LIMIT)
gate = RateGate(MIN_INTERVAL)


def strip_html(value):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html.unescape(str(value or '')))).strip()


def license_info(metadata):
    short = strip_html((metadata.get('LicenseShortName') or metadata.get('UsageTerms') or {}).get('value'))
    if re.match(r'^CC0(?:\s|$)', short, re.I):
        return ('CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/')
    if re.search(r'public domain', short, re.I):
        return ('public-domain', 'https://commons.wikimedia.org/wiki/Commons:Public_domain')
    match = re.search(r'(\d\.\d)', short)
    version = match.group(1) if match else '4.0'
    if re.search(r'CC\s*BY-SA', short, re.I):
        return (f'CC-BY-SA-{version}', f'https://creativecommons.org/licenses/by-sa/{version}/')
    if re.search(r'CC\s*BY', short, re.I):
        return (f'CC-BY-{version}', f'https://creativecommons.org/licenses/by/{version}/')
    return (None, None)


def query_radius_m(lat, cell_size):
    lat_m = cell_size * 111_320 / 2
    lon_m = cell_size * 111_320 * max(0.05, math.cos(math.radians(lat))) / 2
    return min(10_000, max(100, math.sqrt(lat_m * lat_m + lon_m * lon_m) * 1.12))


def commons_request(lat, lon, radius):
    params = {
        'action': 'query', 'format': 'json', 'generator': 'geosearch', 'maxlag': '5',
        'ggsprimary': 'all', 'ggsnamespace': '6', 'ggsradius': str(int(radius)), 'ggslimit': '500',
        'ggscoord': f'{lat}|{lon}', 'prop': 'coordinates|imageinfo',
        'iiprop': 'url|size|extmetadata', 'iiurlwidth': '1800',
        'iiextmetadatafilter': 'Artist|Credit|ImageDescription|LicenseShortName|UsageTerms'
    }
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
    headers = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
    if ACCESS_TOKEN:
        headers['Authorization'] = f'Bearer {ACCESS_TOKEN}'
    for attempt in range(6):
        if not budget.claim():
            return None, 'budget_exhausted'
        gate.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as response:
                return json.load(response), None
        except urllib.error.HTTPError as error:
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5:
                return None, f'HTTP {error.code}'
            retry = error.headers.get('Retry-After')
            delay = float(retry) if retry and retry.isdigit() else min(60, 1.0 * (2 ** attempt))
            gate.defer(delay)
        except Exception as error:
            if attempt == 5:
                return None, str(error)[:200]
            gate.defer(min(15, 1.0 * (2 ** attempt)))
    return None, 'request_failed'


def image_rows(payload):
    rows = []
    pages = list((payload.get('query') or {}).get('pages', {}).values())
    for page in pages:
        info = (page.get('imageinfo') or [{}])[0]
        coord = (page.get('coordinates') or [{}])[0]
        metadata = info.get('extmetadata') or {}
        license_code, license_url = license_info(metadata)
        asset_url = info.get('thumburl') or info.get('url')
        if not license_code or not asset_url or coord.get('lat') is None or coord.get('lon') is None:
            continue
        title = str(page.get('title') or '').removeprefix('File:')
        description = strip_html((metadata.get('ImageDescription') or {}).get('value'))
        author = strip_html((metadata.get('Artist') or metadata.get('Credit') or {}).get('value')) or 'Wikimedia Commons contributor'
        rows.append((
            str(page.get('pageid')), title, description, float(coord['lat']), float(coord['lon']), asset_url,
            f'https://commons.wikimedia.org/wiki/{urllib.parse.quote(str(page.get("title") or "").replace(" ", "_"))}',
            f'{author} · Wikimedia Commons · {license_code}', license_code, license_url,
            int(info.get('width') or 0) or None, int(info.get('height') or 0) or None
        ))
    return rows, len(pages) >= 500


def process_base_cell(cell):
    pending = [cell]
    rows = []
    while pending:
        lat0, lon0, size = pending.pop(0)
        center_lat = lat0 + size / 2
        center_lon = lon0 + size / 2
        payload, error = commons_request(center_lat, center_lon, query_radius_m(center_lat, size))
        if error:
            return {'complete': False, 'rows': rows, 'error': error}
        current, saturated = image_rows(payload or {})
        rows.extend(current)
        if saturated and size / 2 >= MIN_CELL:
            half = size / 2
            pending.extend([
                (lat0, lon0, half), (lat0 + half, lon0, half),
                (lat0, lon0 + half, half), (lat0 + half, lon0 + half, half)
            ])
    return {'complete': True, 'rows': rows, 'error': None}


def normalized_tokens(value):
    return set(token for token in re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).split() if len(token) > 1 and token not in {'the', 'and', 'of', 'at', 'in', 'on'})


def token_similarity(a, b):
    left = normalized_tokens(a)
    right = normalized_tokens(b)
    return (len(left & right) / len(left)) if left and right else 0.0


def countries(con):
    if args.countries.strip():
        return sorted({v.strip().upper() for v in args.countries.split(',') if v.strip()})
    glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    return [str(r[0]) for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]


def merge_candidates(con, country):
    output_key = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=wikimedia-commons/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
    output = f's3://{BUCKET}/{output_key}'
    con.execute('DROP TABLE IF EXISTS new_commons_candidates')
    con.execute(f"""
      CREATE TEMP TABLE new_commons_candidates AS
      SELECT location_id,'wikimedia-commons'::VARCHAR provider,page_id external_photo_id,
             asset_url,page_url,attribution,license,license_url,width,height,distance_m,name_score,rank_score
      FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}
    """)
    if object_exists(output_key):
        con.execute('DROP TABLE IF EXISTS all_commons_candidates')
        con.execute(f"""
          CREATE TEMP TABLE all_commons_candidates AS
          SELECT * FROM read_parquet('{output}')
          UNION ALL BY NAME
          SELECT * FROM new_commons_candidates
        """)
    else:
        con.execute('DROP TABLE IF EXISTS all_commons_candidates')
        con.execute('CREATE TEMP TABLE all_commons_candidates AS SELECT * FROM new_commons_candidates')
    con.execute(f"""
      COPY (
        WITH dedup AS (
          SELECT *, row_number() OVER (
            PARTITION BY location_id, external_photo_id
            ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
          ) duplicate_rank
          FROM all_commons_candidates
        ), ranked AS (
          SELECT * EXCLUDE duplicate_rank,
                 row_number() OVER (
                   PARTITION BY location_id
                   ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
                 ) location_rank
          FROM dedup WHERE duplicate_rank=1
        )
        SELECT * EXCLUDE location_rank FROM ranked WHERE location_rank<={MAX_CANDIDATES}
      ) TO '{output}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000,OVERWRITE_OR_IGNORE true)
    """)
    return con.execute('SELECT count(*) FROM new_commons_candidates').fetchone()[0]


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{B2_KEY_ID.replace("'", "''")}', SECRET '{B2_KEY.replace("'", "''")}',
 REGION '{B2_REGION.replace("'", "''")}', ENDPOINT '{B2_ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")
con.create_function('token_similarity', token_similarity, ['VARCHAR', 'VARCHAR'], 'DOUBLE')

country_list = countries(con)
state_key = f'{STATE_PREFIX}/progress.json'
state = load_json(state_key, {'countryIndex': 0, 'cellOffset': 0, 'complete': False})
if state.get('complete'):
    try:
        completed_at = datetime.fromisoformat(str(state.get('updatedAt') or '').replace('Z', '+00:00'))
        fresh = (datetime.now(timezone.utc) - completed_at).total_seconds() < REFRESH_DAYS * 86400
    except Exception:
        fresh = False
    if fresh:
        print(json.dumps({'provider': 'wikimedia-commons', 'snapshot': args.snapshot, 'complete': True, 'requests': 0, 'rescanDays': REFRESH_DAYS}, indent=2))
        raise SystemExit(0)
    state = {'countryIndex': 0, 'cellOffset': 0, 'complete': False}
    save_json(state_key, state)

country_index = max(0, min(len(country_list), int(state.get('countryIndex', 0))))
cell_offset = max(0, int(state.get('cellOffset', 0)))
summaries = []

while country_index < len(country_list) and budget.used < budget.limit:
    country = country_list[country_index]
    path = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE pois AS
      SELECT id,name,latitude,longitude,
             floor(latitude/{BASE_CELL})*{BASE_CELL} lat0,
             floor(longitude/{BASE_CELL})*{BASE_CELL} lon0
      FROM read_parquet('{path}')
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    base_rows = con.execute('SELECT DISTINCT lat0,lon0 FROM pois ORDER BY lat0,lon0').fetchall()
    cells = [(float(a), float(b), BASE_CELL) for a, b in base_rows]
    if cell_offset >= len(cells):
        country_index += 1
        cell_offset = 0
        save_json(state_key, {
            'countryIndex': country_index, 'cellOffset': 0, 'complete': country_index >= len(country_list),
            'updatedAt': datetime.now(timezone.utc).isoformat(),
        })
        continue

    selected = cells[cell_offset:min(len(cells), cell_offset + max(CONCURRENCY * 64, 256))]
    print(f'{country}: Wikimedia cells {cell_offset}..{cell_offset + len(selected) - 1} of {len(cells)} at {REQUESTS_PER_MINUTE}/minute')

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        results = list(pool.map(process_base_cell, selected, chunksize=1))

    con.execute('DROP TABLE IF EXISTS commons_images')
    con.execute('CREATE TEMP TABLE commons_images(page_id VARCHAR,title VARCHAR,description VARCHAR,latitude DOUBLE,longitude DOUBLE,asset_url VARCHAR,page_url VARCHAR,attribution VARCHAR,license VARCHAR,license_url VARCHAR,width INTEGER,height INTEGER)')
    seen_pages = set()
    for result in results:
        unique = []
        for row in result['rows']:
            if row[0] in seen_pages:
                continue
            seen_pages.add(row[0])
            unique.append(row)
        if unique:
            con.executemany('INSERT INTO commons_images VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', unique)

    con.execute("""
    CREATE OR REPLACE TEMP VIEW ranked_candidates AS
    WITH candidates AS (
      SELECT p.id location_id, c.*,
        6371000 * sqrt(power(radians(c.latitude-p.latitude),2)+power(cos(radians((c.latitude+p.latitude)/2))*radians(c.longitude-p.longitude),2)) distance_m,
        greatest(token_similarity(p.name,c.title),token_similarity(p.name,c.description)) name_score
      FROM pois p JOIN commons_images c
        ON abs(c.latitude-p.latitude)<=0.005 AND abs(c.longitude-p.longitude)<=0.007
    ), scored AS (
      SELECT *, 0.62*name_score + 0.28*(1-least(1,distance_m/500.0)) +
        0.10*(CASE WHEN coalesce(width,0)>=coalesce(height,0) THEN 1 ELSE 0.5 END) rank_score
      FROM candidates WHERE distance_m<=500 AND name_score>=0.25
    )
    SELECT *,row_number() OVER(PARTITION BY location_id ORDER BY rank_score DESC,distance_m,page_id) rank FROM scored;
    """)
    new_candidates = merge_candidates(con, country)

    first_incomplete = next((index for index, result in enumerate(results) if not result['complete']), None)
    completed_cells = len(selected) if first_incomplete is None else first_incomplete
    cell_offset += completed_cells
    if cell_offset >= len(cells):
        country_index += 1
        cell_offset = 0

    save_json(state_key, {
        'countryIndex': country_index,
        'cellOffset': cell_offset,
        'complete': country_index >= len(country_list),
        'updatedAt': datetime.now(timezone.utc).isoformat(),
    })
    summaries.append({
        'country': country,
        'selectedCells': len(selected),
        'completedCells': completed_cells,
        'uniqueImages': len(seen_pages),
        'newCandidates': new_candidates,
        'firstError': results[first_incomplete]['error'] if first_incomplete is not None else None,
    })
    if first_incomplete is not None:
        break

if country_index >= len(country_list):
    save_json(state_key, {
        'countryIndex': len(country_list), 'cellOffset': 0, 'complete': True,
        'updatedAt': datetime.now(timezone.utc).isoformat(),
    })

print(json.dumps({
    'provider': 'wikimedia-commons',
    'snapshot': args.snapshot,
    'scope': SCOPE,
    'requests': budget.used,
    'requestLimit': REQUEST_LIMIT,
    'requestsPerMinute': REQUESTS_PER_MINUTE,
    'maxConcurrency': CONCURRENCY,
    'complete': country_index >= len(country_list),
    'progress': {'countryIndex': country_index, 'countryCount': len(country_list), 'cellOffset': cell_offset},
    'countries': summaries,
}, indent=2))
