#!/usr/bin/env python3
"""Use the full authenticated KartaView quota as a global photo fallback.

KartaView does not provide the same bulk/tile discovery path used for Wikimedia
and Mapillary, so this worker deliberately targets only locations that still have
no stored photo and no higher-priority candidate. Request starts are globally
paced to the configured hourly entitlement (1,000/hour by default with a token).
"""
import argparse
import concurrent.futures
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--countries', default=os.getenv('GLOBAL_PHOTO_COUNTRIES', ''))
parser.add_argument('--limit', type=int, default=int(os.getenv('KARTAVIEW_REQUEST_LIMIT', '1000')))
args = parser.parse_args()

TOKEN = os.getenv('KARTAVIEW_ACCESS_TOKEN', '').strip()
BUCKET = os.environ['B2_DATA_BUCKET_NAME']
ENDPOINT_URL = os.environ['B2_DATA_S3_ENDPOINT'].rstrip('/')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID']
KEY = os.environ['B2_DATA_APPLICATION_KEY']
REGION = os.getenv('B2_DATA_S3_REGION', 'us-west-004')
REQUESTS_PER_HOUR = max(1, min(1000 if TOKEN else 100, int(os.getenv('KARTAVIEW_REQUESTS_PER_HOUR', '1000' if TOKEN else '100'))))
START_INTERVAL = 3600.0 / REQUESTS_PER_HOUR
CONCURRENCY = max(1, min(8, int(os.getenv('KARTAVIEW_MAX_CONCURRENCY', '4'))))
MAX_DISTANCE_M = float(os.getenv('KARTAVIEW_MAX_DISTANCE_M', '45'))
MAX_HEADING_ERROR = float(os.getenv('KARTAVIEW_MAX_HEADING_ERROR', '110'))
LIMIT = max(1, min(1000 if TOKEN else 100, args.limit))
MAX_CANDIDATES = max(1, min(10, int(os.getenv('OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER', '3'))))

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

gate = RateGate(START_INTERVAL)
data_s3 = boto3.client('s3', endpoint_url=ENDPOINT_URL, aws_access_key_id=KEY_ID, aws_secret_access_key=KEY,
                       config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=64))

def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))

def rows_from_payload(payload):
    candidates = [
        (payload.get('result') or {}).get('data'),
        (payload.get('result') or {}).get('currentPageItems'),
        payload.get('result'), payload.get('data'), payload.get('currentPageItems')
    ]
    return next((value for value in candidates if isinstance(value, list)), [])

def asset_url(row):
    value = row.get('procUrl') or row.get('processedUrl') or row.get('imageUrl') or row.get('fileurl') or row.get('fileUrl') or (row.get('sequence') or {}).get('fileurl')
    return str(value).replace('[[sizeprefix]]', 'proc') if value else None

def finite(value):
    try: return float(value)
    except (TypeError, ValueError): return None

def request_location(row):
    params = {
        'lat': str(row['latitude']), 'lng': str(row['longitude']), 'radius': '45', 'zoomLevel': '18',
        'join': 'sequence', 'orderBy': 'id', 'orderDirection': 'desc'
    }
    if TOKEN: params['access_token'] = TOKEN
    url = 'https://api.openstreetcam.org/2.0/photo/?' + urllib.parse.urlencode(params)
    for attempt in range(6):
        gate.wait()
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Puddle/1.0 global KartaView fallback indexer'})
            with urllib.request.urlopen(req, timeout=25) as response:
                payload = json.load(response)
            return row, rows_from_payload(payload)
        except urllib.error.HTTPError as error:
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5: raise
            retry = error.headers.get('Retry-After')
            gate.defer(float(retry) if retry and retry.isdigit() else min(60, 1.0 * (2 ** attempt)))
        except Exception:
            if attempt == 5: raise
            gate.defer(min(20, 1.0 * (2 ** attempt)))
    return row, []

def haversine(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dlat, dlon = math.radians(b_lat-a_lat), math.radians(b_lon-a_lon)
    value = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    return 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0, 1-value)))

def bearing(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat); dlon = math.radians(b_lon-a_lon)
    y = math.sin(dlon)*math.cos(p2)
    x = math.cos(p1)*math.sin(p2)-math.sin(p1)*math.cos(p2)*math.cos(dlon)
    return (math.degrees(math.atan2(y,x))+360)%360

def angle(a, b):
    return abs(((a-b+540)%360)-180)

def score(location, image):
    lat = finite(image.get('lat') or image.get('latitude') or (image.get('gps') or {}).get('lat'))
    lon = finite(image.get('lng') or image.get('lon') or image.get('longitude') or (image.get('gps') or {}).get('lng'))
    if lat is None or lon is None: return None
    distance = haversine(location['latitude'], location['longitude'], lat, lon)
    if distance > MAX_DISTANCE_M: return None
    heading = finite(image.get('heading') or image.get('compassAngle') or (image.get('sequence') or {}).get('heading'))
    target = bearing(lat, lon, location['latitude'], location['longitude'])
    heading_error = angle(heading, target) if heading is not None else None
    if heading_error is not None and heading_error > MAX_HEADING_ERROR: return None
    distance_score = 1-min(1,distance/MAX_DISTANCE_M)
    heading_score = 0.55 if heading_error is None else 1-min(1,heading_error/MAX_HEADING_ERROR)
    return 0.78 + (distance_score*0.55 + heading_score*0.30 + 0.15)*0.22, distance, heading_error

def countries(con):
    if args.countries.strip(): return sorted({v.strip().upper() for v in args.countries.split(',') if v.strip()})
    return [str(r[0]) for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('s3://{BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet', hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{KEY_ID.replace("'","''")}',SECRET '{KEY.replace("'","''")}',REGION '{REGION.replace("'","''")}',ENDPOINT '{ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")

remaining = LIMIT
for country in countries(con):
    if remaining <= 0: break
    loc = f's3://{BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
    existing = []
    bootstrap_prefix = f'normalized/schema=v1/snapshot={args.snapshot}/country_code={country}'
    if prefix_exists(bootstrap_prefix):
        try:
            data_s3.head_object(Bucket=BUCKET, Key=f'{bootstrap_prefix}/photo_metadata.parquet')
            existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{bootstrap_prefix}/photo_metadata.parquet')")
        except Exception: pass
    for provider in ('wikimedia-commons', 'mapillary', 'kartaview'):
        prefix = f'enrichment/photo_candidates/provider={provider}/snapshot={args.snapshot}/country_code={country}'
        if prefix_exists(prefix): existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{prefix}/candidates.parquet')")
    photo_prefix = f'enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}'
    if prefix_exists(photo_prefix): existing.append(f"SELECT location_id FROM read_parquet('s3://{BUCKET}/{photo_prefix}/*.parquet', union_by_name=true)")
    if existing: con.execute(f"CREATE OR REPLACE TEMP VIEW occupied AS {' UNION ALL '.join(existing)}")
    else: con.execute('CREATE OR REPLACE TEMP VIEW occupied AS SELECT NULL::VARCHAR location_id WHERE false')
    requested = con.execute(f"""
      SELECT id location_id, latitude, longitude
      FROM read_parquet('{loc}') l
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM occupied o WHERE o.location_id=l.id)
      ORDER BY id
      LIMIT {remaining}
    """).fetchall()
    locations = [{'location_id': str(row[0]), 'latitude': float(row[1]), 'longitude': float(row[2])} for row in requested]
    if not locations: continue
    print(f'{country}: using up to {len(locations)} KartaView requests at {REQUESTS_PER_HOUR}/hour')
    candidates = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for location, images in pool.map(request_location, locations, chunksize=1):
            ranked = []
            for image in images:
                measured = score(location, image)
                url = asset_url(image); external = image.get('id') or image.get('photoId')
                if not measured or not url or not external: continue
                value, distance, heading_error = measured
                sequence = image.get('sequenceId') or (image.get('sequence') or {}).get('id') or ''
                ranked.append((value, str(external), url, f'https://kartaview.org/details/{urllib.parse.quote(str(sequence))}/{urllib.parse.quote(str(external))}/track-info', distance, heading_error))
            ranked.sort(reverse=True)
            for value, external, url, page_url, distance, heading_error in ranked[:MAX_CANDIDATES]:
                candidates.append((location['location_id'], 'kartaview', external, url, page_url, 'KartaView contributors · CC BY-SA 4.0', 'CC-BY-SA-4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', distance, heading_error, value))
    if candidates:
        con.execute('DROP TABLE IF EXISTS kartaview_results')
        con.execute('CREATE TEMP TABLE kartaview_results(location_id VARCHAR,provider VARCHAR,external_photo_id VARCHAR,asset_url VARCHAR,page_url VARCHAR,attribution VARCHAR,license VARCHAR,license_url VARCHAR,distance_m DOUBLE,heading_error DOUBLE,rank_score DOUBLE)')
        con.executemany('INSERT INTO kartaview_results VALUES (?,?,?,?,?,?,?,?,?,?,?)', candidates)
        out = f's3://{BUCKET}/enrichment/photo_candidates/provider=kartaview/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
        con.execute(f"COPY kartaview_results TO '{out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)")
    print(json.dumps({'country': country, 'requests': len(locations), 'candidates': len(candidates), 'requestsPerHour': REQUESTS_PER_HOUR}, indent=2))
    remaining -= len(locations)
