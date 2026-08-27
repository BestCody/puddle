#!/usr/bin/env python3
"""Build Mapillary photo candidates coverage-first from zoom-14 vector tiles.

The worker uses the documented 50,000 vector-tile requests/day allowance as a
shared UTC-day budget, checkpoints progress in B2, and never spends requests on
tiles that were already completed for the same location snapshot. Candidate
files are merged rather than overwritten so partial runs accumulate coverage.
"""
import argparse
import concurrent.futures
import hashlib
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
from mapbox_vector_tile import decode


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
parser.add_argument('--zoom', type=int, default=int(os.getenv('MAPILLARY_TILE_ZOOM', '14')))
parser.add_argument('--request-limit', type=int, default=int(os.getenv('MAPILLARY_TILE_REQUEST_LIMIT', '12500')))
args = parser.parse_args()
args.snapshot = safe_partition(args.snapshot, 'snapshot')

TOKEN = os.environ['MAPILLARY_ACCESS_TOKEN']
BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not ENDPOINT or not KEY_ID or not KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')

ZOOM = max(14, min(14, args.zoom))
CONCURRENCY = max(1, min(256, int(os.getenv('MAPILLARY_TILE_CONCURRENCY', '96'))))
MAX_DISTANCE_M = float(os.getenv('MAPILLARY_MAX_DISTANCE_M', '45'))
MAX_HEADING_ERROR = float(os.getenv('MAPILLARY_MAX_HEADING_ERROR', '110'))
MAX_CANDIDATES = max(1, min(10, int(os.getenv('OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER', '3'))))
DAILY_REQUEST_LIMIT = max(1, min(50_000, int(os.getenv('MAPILLARY_TILE_DAILY_LIMIT', '50000'))))
REQUEST_LIMIT = max(1, min(DAILY_REQUEST_LIMIT, args.request_limit))
SCOPE = 'all' if not args.countries.strip() else hashlib.sha1(args.countries.strip().upper().encode()).hexdigest()[:12]
STATE_PREFIX = f'{DATA_PREFIX}/enrichment/photo_state/provider=mapillary/snapshot={args.snapshot}/scope={SCOPE}'
QUOTA_PREFIX = f'{DATA_PREFIX}/enrichment/photo_state/provider=mapillary/quota'
REFRESH_DAYS = max(1, min(365, int(os.getenv('MAPILLARY_RESCAN_DAYS', '30'))))

s3 = boto3.client(
    's3',
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=KEY_ID,
    aws_secret_access_key=KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(128, CONCURRENCY * 2)),
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


def reserve_daily_budget():
    today = datetime.now(timezone.utc).date().isoformat()
    key = f'{QUOTA_PREFIX}/quota-{today}.json'
    quota = load_json(key, {'date': today, 'used': 0})
    used = max(0, int(quota.get('used', 0)))
    available = max(0, DAILY_REQUEST_LIMIT - used)
    reserved = min(REQUEST_LIMIT, available)
    if reserved:
        quota = {
            'date': today,
            'used': used + reserved,
            'limit': DAILY_REQUEST_LIMIT,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
        }
        save_json(key, quota)
    return key, used, reserved


def release_unused_budget(key, reserved, used):
    unused = max(0, int(reserved) - int(used))
    if not unused:
        return
    quota = load_json(key, {})
    current = max(0, int(quota.get('used', 0)))
    quota['used'] = max(0, current - unused)
    quota['updatedAt'] = datetime.now(timezone.utc).isoformat()
    save_json(key, quota)


def tile_xy(lat, lon, zoom=ZOOM):
    lat = max(-85.05112878, min(85.05112878, float(lat)))
    n = 2 ** zoom
    x = int((float(lon) + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def tile_point_lonlat(tile_x, tile_y, px, py, extent, zoom=ZOOM):
    n = 2 ** zoom
    world_x = (tile_x + float(px) / extent) / n
    world_y = (tile_y + float(py) / extent) / n
    lon = world_x * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * world_y))))
    return lon, lat


def request_tile(tile, budget):
    x, y = tile
    url = f'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{ZOOM}/{x}/{y}?access_token={urllib.parse.quote(TOKEN, safe="|_")}'
    for attempt in range(6):
        if not budget.claim():
            return tile, b'', 'budget_exhausted'
        req = urllib.request.Request(url, headers={'User-Agent': 'Puddle/1.0 global Mapillary coverage indexer'})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                payload = response.read()
                content_type = response.headers.get_content_type().lower()
                if content_type in {'application/json', 'text/html', 'text/plain'}:
                    return tile, b'', f'permanent:unexpected content type {content_type}'
                return tile, payload, None
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return tile, b'', None
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5:
                return tile, b'', f'HTTP {error.code}'
            retry = error.headers.get('Retry-After')
            delay = float(retry) if retry and retry.isdigit() else min(30, 0.5 * (2 ** attempt))
            time.sleep(delay)
        except Exception as error:
            if attempt == 5:
                return tile, b'', str(error)[:200]
            time.sleep(min(10, 0.5 * (2 ** attempt)))
    return tile, b'', 'request_failed'


def image_rows(tile, payload):
    if not payload:
        return []
    x, y = tile
    layers = decode(payload, default_options={'y_coord_down': True})
    layer = layers.get('image') or {}
    extent = float(layer.get('extent') or 4096)
    output = []
    for feature in layer.get('features', []):
        props = feature.get('properties') or {}
        geometry = feature.get('geometry') or {}
        coords = geometry.get('coordinates') or []
        if geometry.get('type') != 'Point' or len(coords) < 2:
            continue
        image_id = str(props.get('id') or feature.get('id') or '').strip()
        if not image_id:
            continue
        lon, lat = tile_point_lonlat(x, y, coords[0], coords[1], extent)
        output.append((
            image_id, x, y, lat, lon,
            float(props['compass_angle']) if props.get('compass_angle') is not None else None,
            str(props.get('captured_at') or '') or None,
            float(props['quality_score']) if props.get('quality_score') is not None else None,
        ))
    return output


def countries(con):
    if args.countries.strip():
        return sorted({safe_partition(value.strip().upper(), 'country') for value in args.countries.split(',') if value.strip()})
    glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    rows = con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY country_code").fetchall()
    return [safe_partition(row[0], 'country') for row in rows if row[0]]


def merge_candidates(con, country):
    output_key = f'{DATA_PREFIX}/enrichment/photo_candidates/provider=mapillary/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
    output = f's3://{BUCKET}/{output_key}'
    con.execute('DROP TABLE IF EXISTS new_mapillary_candidates')
    con.execute(f"""
      CREATE TEMP TABLE new_mapillary_candidates AS
      SELECT location_id,'mapillary'::VARCHAR provider,external_photo_id,distance_m,heading_error,
             quality_score,local_score rank_score,captured_at
      FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}
    """)
    if object_exists(output_key):
        con.execute('DROP TABLE IF EXISTS all_mapillary_candidates')
        con.execute(f"""
          CREATE TEMP TABLE all_mapillary_candidates AS
          SELECT * FROM read_parquet('{output}')
          UNION ALL BY NAME
          SELECT * FROM new_mapillary_candidates
        """)
    else:
        con.execute('DROP TABLE IF EXISTS all_mapillary_candidates')
        con.execute('CREATE TEMP TABLE all_mapillary_candidates AS SELECT * FROM new_mapillary_candidates')
    con.execute(f"""
      COPY (
        WITH dedup AS (
          SELECT *, row_number() OVER (
            PARTITION BY location_id, external_photo_id
            ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
          ) duplicate_rank
          FROM all_mapillary_candidates
        ), ranked AS (
          SELECT * EXCLUDE duplicate_rank,
                 row_number() OVER (
                   PARTITION BY location_id
                   ORDER BY coalesce(rank_score,0) DESC, coalesce(distance_m,1e18), external_photo_id
                 ) location_rank
          FROM dedup WHERE duplicate_rank=1
        )
        SELECT * EXCLUDE location_rank FROM ranked WHERE location_rank<={MAX_CANDIDATES}
      ) TO '{output}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000, OVERWRITE_OR_IGNORE true)
    """)
    return con.execute('SELECT count(*) FROM new_mapillary_candidates').fetchone()[0]


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(32, int(os.getenv('GLOBAL_PHOTO_THREADS', '8'))))}")
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{KEY_ID.replace("'", "''")}', SECRET '{KEY.replace("'", "''")}',
 REGION '{REGION.replace("'", "''")}', ENDPOINT '{ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")
con.create_function('map_tile_x', lambda lat, lon: tile_xy(lat, lon)[0], ['DOUBLE', 'DOUBLE'], 'BIGINT')
con.create_function('map_tile_y', lambda lat, lon: tile_xy(lat, lon)[1], ['DOUBLE', 'DOUBLE'], 'BIGINT')

country_list = countries(con)
state_key = f'{STATE_PREFIX}/progress.json'
state = load_json(state_key, {'countryIndex': 0, 'tileOffset': 0, 'complete': False})
if state.get('complete'):
    try:
        completed_at = datetime.fromisoformat(str(state.get('updatedAt') or '').replace('Z', '+00:00'))
        fresh = (datetime.now(timezone.utc) - completed_at).total_seconds() < REFRESH_DAYS * 86400
    except Exception:
        fresh = False
    if fresh:
        print(json.dumps({'provider': 'mapillary', 'snapshot': args.snapshot, 'complete': True, 'requests': 0, 'rescanDays': REFRESH_DAYS}, indent=2))
        raise SystemExit(0)
    state = {'countryIndex': 0, 'tileOffset': 0, 'complete': False}
    save_json(state_key, state)

quota_key, quota_used_before, reserved = reserve_daily_budget()
if reserved <= 0:
    print(json.dumps({
        'provider': 'mapillary',
        'snapshot': args.snapshot,
        'dailyLimit': DAILY_REQUEST_LIMIT,
        'requestsAlreadyUsedToday': quota_used_before,
        'requests': 0,
        'stoppedReason': 'daily_quota_exhausted',
    }, indent=2))
    raise SystemExit(0)

budget = RequestBudget(reserved)
country_index = max(0, min(len(country_list), int(state.get('countryIndex', 0))))
tile_offset = max(0, int(state.get('tileOffset', 0)))
summaries = []

try:
    while country_index < len(country_list) and budget.used < budget.limit:
        country = country_list[country_index]
        path = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE pois AS
          SELECT id,name,category,latitude,longitude,
                 map_tile_x(latitude,longitude) tx,map_tile_y(latitude,longitude) ty
          FROM read_parquet('{path}')
          WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        """)
        tile_rows = con.execute(f"""
          SELECT DISTINCT tx+dx x, ty+dy y
          FROM pois, range(-1,2) a(dx), range(-1,2) b(dy)
          WHERE tx+dx>=0 AND ty+dy>=0 AND tx+dx<{2**ZOOM} AND ty+dy<{2**ZOOM}
          ORDER BY x,y
        """).fetchall()
        tiles = [(int(x), int(y)) for x, y in tile_rows]
        if tile_offset >= len(tiles):
            country_index += 1
            tile_offset = 0
            save_json(state_key, {
                'countryIndex': country_index, 'tileOffset': 0, 'complete': country_index >= len(country_list),
                'updatedAt': datetime.now(timezone.utc).isoformat(),
            })
            continue

        remaining_tokens = budget.limit - budget.used
        selected = tiles[tile_offset:tile_offset + remaining_tokens]
        print(f'{country}: Mapillary tiles {tile_offset}..{tile_offset + len(selected) - 1} of {len(tiles)}; {remaining_tokens} request tokens remain')

        con.execute('DROP TABLE IF EXISTS mapillary_images')
        con.execute('CREATE TEMP TABLE mapillary_images(image_id VARCHAR, tx BIGINT, ty BIGINT, latitude DOUBLE, longitude DOUBLE, heading DOUBLE, captured_at VARCHAR, quality_score DOUBLE)')
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for result in pool.map(lambda tile: request_tile(tile, budget), selected, chunksize=1):
                results.append(result)

        inserted = 0
        first_incomplete = None
        failures = []
        for index, (tile, payload, error) in enumerate(results):
            retryable_error = error and not str(error).startswith('permanent:')
            if retryable_error and first_incomplete is None:
                first_incomplete = index
            if error:
                failures.append({'tile': tile, 'error': error})
                continue
            try:
                rows = image_rows(tile, payload)
            except Exception as decode_error:
                # A malformed 200 response is isolated to its tile. It must
                # not rewind the whole country or abort a near-complete run;
                # the next snapshot will naturally retry the tile.
                failures.append({'tile': tile, 'error': f'permanent:decode {decode_error}'})
                continue
            if rows:
                con.executemany('INSERT INTO mapillary_images VALUES (?,?,?,?,?,?,?,?)', rows)
                inserted += len(rows)

        con.execute(f"""
        CREATE OR REPLACE TEMP VIEW ranked_candidates AS
        WITH nearby AS (
          SELECT
            p.id location_id, i.image_id external_photo_id, i.latitude image_latitude, i.longitude image_longitude,
            i.heading, i.captured_at, i.quality_score,
            6371000 * sqrt(
              power(radians(i.latitude-p.latitude),2) +
              power(cos(radians((i.latitude+p.latitude)/2))*radians(i.longitude-p.longitude),2)
            ) distance_m,
            degrees(atan2(
              sin(radians(p.longitude-i.longitude))*cos(radians(p.latitude)),
              cos(radians(i.latitude))*sin(radians(p.latitude))-sin(radians(i.latitude))*cos(radians(p.latitude))*cos(radians(p.longitude-i.longitude))
            )) bearing
          FROM pois p JOIN mapillary_images i ON abs(p.tx-i.tx)<=1 AND abs(p.ty-i.ty)<=1
        ), scored AS (
          SELECT *,
            abs(mod(coalesce(heading,bearing)-bearing+540,360)-180) heading_error,
            (1-least(1,distance_m/{MAX_DISTANCE_M}))*0.55 +
            (CASE WHEN heading IS NULL THEN 0.55 ELSE 1-least(1,abs(mod(heading-bearing+540,360)-180)/{MAX_HEADING_ERROR}) END)*0.25 +
            coalesce(quality_score,0.5)*0.20 AS local_score
          FROM nearby WHERE distance_m <= {MAX_DISTANCE_M}
        )
        SELECT *, row_number() OVER (PARTITION BY location_id ORDER BY local_score DESC, distance_m ASC, external_photo_id) rank
        FROM scored WHERE heading IS NULL OR heading_error <= {MAX_HEADING_ERROR};
        """)
        new_candidates = merge_candidates(con, country)

        completed_tiles = len(selected) if first_incomplete is None else first_incomplete
        tile_offset += completed_tiles
        if tile_offset >= len(tiles):
            country_index += 1
            tile_offset = 0
        save_json(state_key, {
            'countryIndex': country_index,
            'tileOffset': tile_offset,
            'complete': country_index >= len(country_list),
            'updatedAt': datetime.now(timezone.utc).isoformat(),
        })
        summaries.append({
            'country': country,
            'selectedTiles': len(selected),
            'completedTiles': completed_tiles,
            'decodedImages': inserted,
            'newCandidates': new_candidates,
            'failures': failures[:5],
        })
        if first_incomplete is not None:
            break

    if country_index >= len(country_list):
        save_json(state_key, {
            'countryIndex': len(country_list), 'tileOffset': 0, 'complete': True,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
        })
finally:
    release_unused_budget(quota_key, reserved, budget.used)

print(json.dumps({
    'provider': 'mapillary',
    'snapshot': args.snapshot,
    'scope': SCOPE,
    'requests': budget.used,
    'reservedRequests': reserved,
    'dailyLimit': DAILY_REQUEST_LIMIT,
    'complete': country_index >= len(country_list),
    'progress': {'countryIndex': country_index, 'countryCount': len(country_list), 'tileOffset': tile_offset},
    'countries': summaries,
}, indent=2))
