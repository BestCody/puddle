#!/usr/bin/env python3
"""Build Mapillary photo candidates coverage-first from zoom-14 vector tiles.

One tile request serves every Puddle POI in that area. This replaces the old
one-Graph-request-per-location architecture. The script aggressively runs
parallel tile requests and only backs off on provider 429/5xx responses.
"""
import argparse
import concurrent.futures
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import duckdb
from mapbox_vector_tile import decode


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
parser.add_argument('--zoom', type=int, default=int(os.getenv('MAPILLARY_TILE_ZOOM', '14')))
args = parser.parse_args()

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


def request_tile(tile):
    x, y = tile
    url = f'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{ZOOM}/{x}/{y}?access_token={urllib.parse.quote(TOKEN, safe="|_")}'
    for attempt in range(6):
        req = urllib.request.Request(url, headers={'User-Agent': 'Puddle/1.0 global Mapillary coverage indexer'})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return tile, response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return tile, b''
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 5:
                raise
            retry = error.headers.get('Retry-After')
            delay = float(retry) if retry and retry.isdigit() else min(30, 0.5 * (2 ** attempt))
            time.sleep(delay)
        except Exception:
            if attempt == 5:
                raise
            time.sleep(min(10, 0.5 * (2 ** attempt)))
    return tile, b''


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
        return sorted({value.strip().upper() for value in args.countries.split(',') if value.strip()})
    glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
    rows = con.execute(f"SELECT DISTINCT country_code FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY country_code").fetchall()
    return [str(row[0]) for row in rows if row[0]]


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

for country in countries(con):
    path = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet'
    con.execute(f"CREATE OR REPLACE TEMP TABLE pois AS SELECT id,name,category,latitude,longitude,map_tile_x(latitude,longitude) tx,map_tile_y(latitude,longitude) ty FROM read_parquet('{path}') WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
    tile_rows = con.execute('SELECT DISTINCT tx+dx x, ty+dy y FROM pois, range(-1,2) a(dx), range(-1,2) b(dy)').fetchall()
    tiles = [(int(x), int(y)) for x, y in tile_rows if x >= 0 and y >= 0 and x < 2**ZOOM and y < 2**ZOOM]
    print(f'{country}: fetching {len(tiles)} unique Mapillary coverage tiles for {con.execute("SELECT count(*) FROM pois").fetchone()[0]} POIs')

    con.execute('DROP TABLE IF EXISTS mapillary_images')
    con.execute('CREATE TEMP TABLE mapillary_images(image_id VARCHAR, tx BIGINT, ty BIGINT, latitude DOUBLE, longitude DOUBLE, heading DOUBLE, captured_at VARCHAR, quality_score DOUBLE)')
    inserted = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for tile, payload in pool.map(request_tile, tiles, chunksize=1):
            rows = image_rows(tile, payload)
            if rows:
                con.executemany('INSERT INTO mapillary_images VALUES (?,?,?,?,?,?,?,?)', rows)
                inserted += len(rows)
            if inserted and inserted % 10000 < len(rows):
                print(f'{country}: decoded {inserted} Mapillary image points')

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
    output = f's3://{BUCKET}/{DATA_PREFIX}/enrichment/photo_candidates/provider=mapillary/snapshot={args.snapshot}/country_code={country}/candidates.parquet'
    con.execute(f"COPY (SELECT location_id,'mapillary'::VARCHAR provider,external_photo_id,distance_m,heading_error,quality_score,local_score rank_score,captured_at FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}) TO '{output}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000, OVERWRITE_OR_IGNORE true)")
    candidate_count = con.execute(f'SELECT count(*) FROM ranked_candidates WHERE rank<={MAX_CANDIDATES}').fetchone()[0]
    print(f'{country}: wrote {candidate_count} Mapillary candidates')
