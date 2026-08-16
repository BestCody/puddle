#!/usr/bin/env python3
"""Build Wikimedia Commons candidates with one geosearch per occupied geographic cell.

This replaces one API request per POI. Dense cells automatically subdivide when
the API result cap is reached. Requests use the configured provider entitlement
at its full rate while respecting Wikimedia's three-concurrent-request guidance.
"""
import argparse
import concurrent.futures
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

import duckdb

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--countries', default=os.getenv('GLOBAL_PHOTO_COUNTRIES', ''))
args = parser.parse_args()

BUCKET = os.environ['B2_DATA_BUCKET_NAME']
B2_ENDPOINT = os.environ['B2_DATA_S3_ENDPOINT'].replace('https://', '').replace('http://', '').rstrip('/')
B2_KEY_ID = os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID']
B2_KEY = os.environ['B2_DATA_APPLICATION_KEY']
B2_REGION = os.getenv('B2_DATA_S3_REGION', 'us-west-004')
BASE_CELL = max(0.01, min(0.1, float(os.getenv('WIKIMEDIA_CELL_DEGREES', '0.05'))))
MIN_CELL = max(0.003, min(BASE_CELL, float(os.getenv('WIKIMEDIA_MIN_CELL_DEGREES', '0.00625'))))
REQUESTS_PER_MINUTE = max(1, min(2000, int(os.getenv('WIKIMEDIA_REQUESTS_PER_MINUTE', '200'))))
MIN_INTERVAL = 60.0 / REQUESTS_PER_MINUTE
CONCURRENCY = max(1, min(3, int(os.getenv('WIKIMEDIA_MAX_CONCURRENCY', '3'))))
ACCESS_TOKEN = os.getenv('WIKIMEDIA_ACCESS_TOKEN', '').strip()
MAX_CANDIDATES = max(1, min(10, int(os.getenv('OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER', '3'))))
USER_AGENT = os.getenv('WIKIMEDIA_USER_AGENT', 'Puddle/1.0 global location photo indexer (contact via configured site URL)')

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
            self.paused_until = max(self.paused_until, time.monotonic() + seconds)

gate = RateGate(MIN_INTERVAL)

def strip_html(value):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html.unescape(str(value or '')))).strip()

def license_info(metadata):
    short = strip_html((metadata.get('LicenseShortName') or metadata.get('UsageTerms') or {}).get('value'))
    if re.match(r'^CC0(?:\s|$)', short, re.I): return ('CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/')
    if re.search(r'public domain', short, re.I): return ('public-domain', 'https://commons.wikimedia.org/wiki/Commons:Public_domain')
    version = (re.search(r'(\d\.\d)', short) or [None, '4.0'])[1]
    if re.search(r'CC\s*BY-SA', short, re.I): return (f'CC-BY-SA-{version}', f'https://creativecommons.org/licenses/by-sa/{version}/')
    if re.search(r'CC\s*BY', short, re.I): return (f'CC-BY-{version}', f'https://creativecommons.org/licenses/by/{version}/')
    return (None, None)

def query_radius_m(lat, cell_size):
    lat_m = cell_size * 111_320 / 2
    lon_m = cell_size * 111_320 * max(0.05, math.cos(math.radians(lat))) / 2
    return min(10_000, max(100, math.sqrt(lat_m*lat_m + lon_m*lon_m) * 1.12))

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
        gate.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in {408,425,429,500,502,503,504} or attempt == 5:
                raise
            retry = error.headers.get('Retry-After')
            delay = float(retry) if retry and retry.isdigit() else min(60, 1.0 * (2 ** attempt))
            gate.defer(delay)
        except Exception:
            if attempt == 5: raise
            gate.defer(min(15, 1.0 * (2 ** attempt)))
    return {}

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

def cell_request(cell):
    lat0, lon0, size = cell
    center_lat = lat0 + size/2
    center_lon = lon0 + size/2
    payload = commons_request(center_lat, center_lon, query_radius_m(center_lat, size))
    rows, saturated = image_rows(payload)
    if saturated and size/2 >= MIN_CELL:
        half = size/2
        return rows, [(lat0,lon0,half),(lat0+half,lon0,half),(lat0,lon0+half,half),(lat0+half,lon0+half,half)]
    return rows, []

def normalized_tokens(value):
    return set(token for token in re.sub(r'[^a-z0-9]+',' ',str(value or '').lower()).split() if len(token)>1 and token not in {'the','and','of','at','in','on'})

def token_similarity(a,b):
    left=normalized_tokens(a); right=normalized_tokens(b)
    return (len(left & right)/len(left)) if left and right else 0.0

def countries(con):
    if args.countries.strip(): return sorted({v.strip().upper() for v in args.countries.split(',') if v.strip()})
    return [str(r[0]) for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('s3://{BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet', hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{B2_KEY_ID.replace("'", "''")}', SECRET '{B2_KEY.replace("'", "''")}',
 REGION '{B2_REGION.replace("'", "''")}', ENDPOINT '{B2_ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")
con.create_function('token_similarity', token_similarity, ['VARCHAR','VARCHAR'], 'DOUBLE')

for country in countries(con):
    path=f's3://{BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
    con.execute(f"CREATE OR REPLACE TEMP TABLE pois AS SELECT id,name,latitude,longitude,floor(latitude/{BASE_CELL})*{BASE_CELL} lat0,floor(longitude/{BASE_CELL})*{BASE_CELL} lon0 FROM read_parquet('{path}') WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
    cells=[(float(a),float(b),BASE_CELL) for a,b in con.execute('SELECT DISTINCT lat0,lon0 FROM pois ORDER BY lat0,lon0').fetchall()]
    print(f'{country}: {len(cells)} occupied Wikimedia cells at {REQUESTS_PER_MINUTE} requests/minute')
    con.execute('DROP TABLE IF EXISTS commons_images')
    con.execute('CREATE TEMP TABLE commons_images(page_id VARCHAR,title VARCHAR,description VARCHAR,latitude DOUBLE,longitude DOUBLE,asset_url VARCHAR,page_url VARCHAR,attribution VARCHAR,license VARCHAR,license_url VARCHAR,width INTEGER,height INTEGER)')
    seen_pages=set()
    pending=cells
    total_requests=0
    while pending:
        next_cells=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for rows, subdivisions in pool.map(cell_request,pending,chunksize=1):
                total_requests += 1
                unique=[row for row in rows if row[0] not in seen_pages]
                for row in unique: seen_pages.add(row[0])
                if unique: con.executemany('INSERT INTO commons_images VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',unique)
                next_cells.extend(subdivisions)
        pending=next_cells
        if pending: print(f'{country}: subdividing {len(pending)} saturated cells')

    con.execute("""
    CREATE OR REPLACE TEMP VIEW ranked_candidates AS
    WITH candidates AS (
      SELECT p.id location_id, c.*,
        6371000 * sqrt(power(radians(c.latitude-p.latitude),2)+power(cos(radians((c.latitude+p.latitude)/2))*radians(c.longitude-p.longitude),2)) distance_m,
        greatest(token_similarity(p.name,c.title),token_similarity(p.name,c.description)) name_score
      FROM pois p JOIN commons_images c
        ON abs(c.latitude-p.latitude)<=0.005 AND abs(c.longitude-p.longitude)<=0.007
    ), scored AS (
      SELECT *, 0.62*name_score + 0.28*(1-least(1,distance_m/500.0)) + 0.10*(CASE WHEN coalesce(width,0)>=coalesce(height,0) THEN 1 ELSE 0.5 END) rank_score
      FROM candidates WHERE distance_m<=500 AND name_score>=0.25
    )
    SELECT *,row_number() OVER(PARTITION BY location_id ORDER BY rank_score DESC,distance_m,page_id) rank FROM scored;
    """)
    out=f's3://{BUCKET}/enrichment/photo_candidates/provider=wikimedia-commons/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
    con.execute(f"COPY (SELECT location_id,'wikimedia-commons'::VARCHAR provider,page_id external_photo_id,asset_url,page_url,attribution,license,license_url,width,height,distance_m,name_score,rank_score FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}) TO '{out}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000,OVERWRITE_OR_IGNORE true)")
    count=con.execute(f'SELECT count(*) FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}').fetchone()[0]
    print(f'{country}: {total_requests} API requests produced {len(seen_pages)} unique images and {count} POI candidates')
