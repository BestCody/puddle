#!/usr/bin/env python3
"""Project current Supabase photo/Google metadata into the normalized B2 snapshot.

Run after the bootstrap export and before OpenSearch indexing. This does not make
Supabase canonical; it only carries existing first-party/enrichment state forward.
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
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{KEY_ID.replace("'", "''")}', SECRET '{KEY.replace("'", "''")}',
 REGION '{REGION.replace("'", "''")}', ENDPOINT '{ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")

# Resolve overlay rows against the canonical snapshot itself rather than assuming
# the historical Supabase locations table exposes the same country partition key.
# This also ensures metadata is only carried forward for canonical location IDs
# that actually exist in the snapshot being activated.
con.execute(f"""
CREATE OR REPLACE TEMP VIEW canonical_locations AS
SELECT
  cast(id AS VARCHAR) id,
  upper(regexp_extract(filename, 'country_code=([^/]+)', 1)) AS country_code
FROM read_parquet('{OUT}/country_code=*/locations.parquet', union_by_name=true, filename=true);
""")
con.execute(f"CREATE OR REPLACE TEMP VIEW photo_rows AS SELECT * FROM read_parquet('{BOOT}/location_photo_sources.parquet')")
con.execute(f"CREATE OR REPLACE TEMP VIEW google_rows AS SELECT * FROM read_parquet('{BOOT}/location_google_places.parquet')")

con.execute("""
CREATE OR REPLACE TEMP VIEW primary_photos AS
SELECT * EXCLUDE(rn) FROM (
  SELECT
    cast(p.location_id AS VARCHAR) location_id,
    l.country_code,
    cast(p.remote_url AS VARCHAR) url,
    cast(p.provider AS VARCHAR) provider,
    cast(p.attribution_text AS VARCHAR) attribution,
    cast(p.attribution_url AS VARCHAR) attribution_url,
    cast(p.license_code AS VARCHAR) license,
    try_cast(p.width AS INTEGER) width,
    try_cast(p.height AS INTEGER) height,
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
  JOIN canonical_locations l ON l.id=cast(p.location_id AS VARCHAR)
  WHERE cast(p.status AS VARCHAR)='approved'
    AND coalesce(try_cast(p.is_ai_generated AS BOOLEAN), false)=false
    AND p.remote_url IS NOT NULL
    AND (
      try_cast(p.expires_at AS TIMESTAMP) IS NULL
      OR try_cast(p.expires_at AS TIMESTAMP) > now()
    )
) WHERE rn=1;
""")
con.execute("""
CREATE OR REPLACE TEMP VIEW verified_google AS
SELECT
  cast(g.location_id AS VARCHAR) location_id,
  l.country_code,
  cast(g.google_place_id AS VARCHAR) google_place_id,
  try_cast(g.match_score AS DOUBLE) google_place_match_score
FROM google_rows g
JOIN canonical_locations l ON l.id=cast(g.location_id AS VARCHAR)
WHERE cast(g.status AS VARCHAR)='verified'
  AND g.google_place_id IS NOT NULL;
""")

photo_count = con.execute('SELECT count(*) FROM primary_photos').fetchone()[0]
google_count = con.execute('SELECT count(*) FROM verified_google').fetchone()[0]
print(f'overlay candidates: primary_photos={photo_count} verified_google={google_count}')

for country, in con.execute('SELECT DISTINCT country_code FROM canonical_locations ORDER BY country_code').fetchall():
    safe = str(country or 'ZZ').upper()
    if not safe:
        safe = 'ZZ'
    con.execute(
        f"COPY (SELECT location_id,url,provider,attribution,attribution_url,license,width,height "
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

print('bootstrap photo and Google overlays projected into canonical snapshot')
