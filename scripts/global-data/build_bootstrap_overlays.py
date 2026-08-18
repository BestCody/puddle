#!/usr/bin/env python3
"""Project current Supabase photo/Google metadata into the normalized B2 snapshot.

Run after the bootstrap export and before OpenSearch indexing. This does not make
Supabase canonical; it only carries existing first-party/enrichment state forward.
The canonical lookup and overlay selections are materialized once so country
writes do not repeatedly rescan the global snapshot.
"""
import argparse
import os
from datetime import datetime, timezone

import duckdb


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
parser.add_argument('--bootstrap-prefix', default=os.getenv('GLOBAL_BOOTSTRAP_B2_PREFIX', 'data/snapshots/bootstrap/current'))
args = parser.parse_args()

BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not ENDPOINT or not KEY_ID or not KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')
BOOT = f"s3://{BUCKET}/{clean_prefix(args.bootstrap_prefix)}"
OUT = f"s3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}"

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(16, int(os.getenv('GLOBAL_OVERLAY_THREADS', '8'))))}")
temp_dir = os.getenv('DUCKDB_TEMP_DIRECTORY', '').strip()
if temp_dir:
    os.makedirs(temp_dir, exist_ok=True)
    con.execute(f"SET temp_directory='{temp_dir.replace("'", "''")}'")
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{KEY_ID.replace("'", "''")}', SECRET '{KEY.replace("'", "''")}',
 REGION '{REGION.replace("'", "''")}', ENDPOINT '{ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")

con.execute(f"CREATE OR REPLACE TEMP VIEW photo_rows AS SELECT * FROM read_parquet('{BOOT}/location_photo_sources.parquet')")
con.execute(f"CREATE OR REPLACE TEMP VIEW media_rows AS SELECT * FROM read_parquet('{BOOT}/media_objects.parquet')")
con.execute(f"CREATE OR REPLACE TEMP VIEW google_rows AS SELECT * FROM read_parquet('{BOOT}/location_google_places.parquet')")

# Limit the global canonical scan to IDs that can possibly receive an overlay.
# This still scans the canonical Parquet once, but keeps the materialized join
# state bounded by the small existing Puddle catalogue instead of 30M locations.
con.execute("""
CREATE OR REPLACE TEMP TABLE overlay_ids AS
SELECT DISTINCT cast(location_id AS VARCHAR) id
FROM photo_rows
WHERE location_id IS NOT NULL
UNION
SELECT DISTINCT cast(location_id AS VARCHAR) id
FROM google_rows
WHERE location_id IS NOT NULL;
""")
con.execute(f"""
CREATE OR REPLACE TEMP TABLE canonical_overlay_locations AS
SELECT
  cast(c.id AS VARCHAR) id,
  upper(regexp_extract(filename, 'country_code=([^/]+)', 1)) AS country_code
FROM read_parquet('{OUT}/country_code=*/locations.parquet', union_by_name=true, filename=true) c
JOIN overlay_ids o ON o.id=cast(c.id AS VARCHAR);
""")

invalid_b2_photos = con.execute("""
SELECT count(*)
FROM photo_rows p
LEFT JOIN media_rows m ON cast(m.id AS VARCHAR)=cast(p.media_object_id AS VARCHAR)
WHERE cast(p.status AS VARCHAR)='approved'
  AND coalesce(try_cast(p.is_ai_generated AS BOOLEAN), false)=false
  AND lower(coalesce(cast(p.storage_backend AS VARCHAR),''))='b2'
  AND (
    m.id IS NULL
    OR lower(coalesce(cast(m.storage_backend AS VARCHAR),'')) <> 'b2'
    OR NOT regexp_full_match(lower(coalesce(cast(m.content_hash AS VARCHAR),'')), '[0-9a-f]{64}')
    OR cast(m.storage_key AS VARCHAR) <> 'media/photos/by-sha256/' || substr(lower(cast(m.content_hash AS VARCHAR)),1,2) || '/' || lower(cast(m.content_hash AS VARCHAR)) || '.jpg'
  );
""").fetchone()[0]
if invalid_b2_photos:
    raise RuntimeError(f'{invalid_b2_photos} approved B2 photos are missing canonical media_objects identity')

con.execute("""
CREATE OR REPLACE TEMP TABLE primary_photos AS
SELECT * EXCLUDE(rn) FROM (
  SELECT
    cast(p.location_id AS VARCHAR) location_id,
    l.country_code,
    lower(cast(m.content_hash AS VARCHAR)) content_hash,
    cast(p.provider AS VARCHAR) provider,
    cast(p.attribution_text AS VARCHAR) attribution,
    cast(p.attribution_url AS VARCHAR) attribution_url,
    cast(p.license_code AS VARCHAR) license,
    coalesce(try_cast(m.width AS INTEGER), try_cast(p.width AS INTEGER)) width,
    coalesce(try_cast(m.height AS INTEGER), try_cast(p.height AS INTEGER)) height,
    row_number() OVER (
      PARTITION BY cast(p.location_id AS VARCHAR)
      ORDER BY
        coalesce(try_cast(p.is_primary AS BOOLEAN), false) DESC,
        CASE cast(p.source AS VARCHAR)
          WHEN 'venue' THEN 0
          WHEN 'puddle_user' THEN 1
          WHEN 'provider' THEN 2
          WHEN 'licensed_public' THEN 3
          ELSE 9
        END,
        coalesce(try_cast(p.sort_order AS INTEGER), 0),
        coalesce(try_cast(p.verified_at AS TIMESTAMP), TIMESTAMP '1970-01-01') DESC
    ) rn
  FROM photo_rows p
  JOIN media_rows m ON cast(m.id AS VARCHAR)=cast(p.media_object_id AS VARCHAR)
  JOIN canonical_overlay_locations l ON l.id=cast(p.location_id AS VARCHAR)
  WHERE cast(p.status AS VARCHAR)='approved'
    AND coalesce(try_cast(p.is_ai_generated AS BOOLEAN), false)=false
    AND lower(coalesce(cast(p.storage_backend AS VARCHAR),''))='b2'
    AND lower(coalesce(cast(m.storage_backend AS VARCHAR),''))='b2'
    AND regexp_full_match(lower(cast(m.content_hash AS VARCHAR)), '[0-9a-f]{64}')
    AND cast(m.storage_key AS VARCHAR) = 'media/photos/by-sha256/' || substr(lower(cast(m.content_hash AS VARCHAR)),1,2) || '/' || lower(cast(m.content_hash AS VARCHAR)) || '.jpg'
    AND (
      try_cast(p.expires_at AS TIMESTAMP) IS NULL
      OR try_cast(p.expires_at AS TIMESTAMP) > now()
    )
) WHERE rn=1;
""")
con.execute("""
CREATE OR REPLACE TEMP TABLE verified_google AS
SELECT * EXCLUDE(rn) FROM (
  SELECT
    cast(g.location_id AS VARCHAR) location_id,
    l.country_code,
    cast(g.google_place_id AS VARCHAR) google_place_id,
    try_cast(g.match_score AS DOUBLE) google_place_match_score,
    row_number() OVER (
      PARTITION BY cast(g.location_id AS VARCHAR)
      ORDER BY cast(g.google_place_id AS VARCHAR)
    ) rn
  FROM google_rows g
  JOIN canonical_overlay_locations l ON l.id=cast(g.location_id AS VARCHAR)
  WHERE cast(g.status AS VARCHAR)='verified'
    AND g.google_place_id IS NOT NULL
) WHERE rn=1;
""")

photo_count = con.execute('SELECT count(*) FROM primary_photos').fetchone()[0]
google_count = con.execute('SELECT count(*) FROM verified_google').fetchone()[0]
matched_ids = con.execute('SELECT count(*) FROM canonical_overlay_locations').fetchone()[0]
print(f'overlay candidates: matched_location_ids={matched_ids} primary_photos={photo_count} verified_google={google_count}')

# Write only countries touched by current Puddle overlay IDs. Files are fixed-key
# snapshot objects, so reruns replace the active object rather than append rows.
countries = [
    row[0]
    for row in con.execute(
        "SELECT DISTINCT country_code FROM canonical_overlay_locations WHERE country_code IS NOT NULL ORDER BY 1"
    ).fetchall()
]
for country in countries:
    safe = str(country or 'ZZ').upper() or 'ZZ'
    con.execute(
        f"COPY (SELECT location_id,content_hash,provider,attribution,attribution_url,license,width,height "
        f"FROM primary_photos WHERE country_code='{safe}') "
        f"TO '{OUT}/country_code={safe}/photo_metadata.parquet' "
        "(FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)"
    )
    con.execute(
        f"COPY (SELECT location_id,google_place_id,google_place_match_score "
        f"FROM verified_google WHERE country_code='{safe}') "
        f"TO '{OUT}/country_code={safe}/google_places.parquet' "
        "(FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)"
    )

print(f'bootstrap photo and Google overlays projected into canonical snapshot across {len(countries)} countries')
