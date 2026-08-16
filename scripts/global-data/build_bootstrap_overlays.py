#!/usr/bin/env python3
"""Project current Supabase photo/Google metadata into the normalized B2 snapshot.

Run after the bootstrap export and before OpenSearch indexing. This does not make
Supabase canonical; it only carries existing first-party/enrichment state forward.
"""
import argparse
import os
from datetime import datetime, timezone

import duckdb

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--bootstrap-prefix', default=os.getenv('GLOBAL_BOOTSTRAP_B2_PREFIX', 'bootstrap/current'))
args = parser.parse_args()

BUCKET = os.environ['B2_DATA_BUCKET_NAME']
ENDPOINT = os.environ['B2_DATA_S3_ENDPOINT'].replace('https://', '').replace('http://', '').rstrip('/')
KEY_ID = os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID']
KEY = os.environ['B2_DATA_APPLICATION_KEY']
REGION = os.getenv('B2_DATA_S3_REGION', 'us-west-004')
BOOT = f"s3://{BUCKET}/{args.bootstrap_prefix.strip('/')}"
OUT = f"s3://{BUCKET}/normalized/schema=v1/snapshot={args.snapshot}"

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
 TYPE S3, KEY_ID '{KEY_ID.replace("'", "''")}', SECRET '{KEY.replace("'", "''")}',
 REGION '{REGION.replace("'", "''")}', ENDPOINT '{ENDPOINT.replace("'", "''")}', URL_STYLE 'path', USE_SSL true
);
""")
con.execute(f"CREATE OR REPLACE TEMP VIEW bootstrap_locations AS SELECT cast(id as varchar) id, coalesce(country_code,'ZZ') country_code FROM read_parquet('{BOOT}/locations.parquet')")
con.execute(f"CREATE OR REPLACE TEMP VIEW photo_rows AS SELECT * FROM read_parquet('{BOOT}/location_photo_sources.parquet')")
con.execute(f"CREATE OR REPLACE TEMP VIEW google_rows AS SELECT * FROM read_parquet('{BOOT}/location_google_places.parquet')")

con.execute("""
CREATE OR REPLACE TEMP VIEW primary_photos AS
SELECT * EXCLUDE(rn) FROM (
  SELECT
    cast(p.location_id as varchar) location_id,
    l.country_code,
    p.remote_url url,
    p.provider,
    p.attribution_text attribution,
    p.attribution_url,
    p.license_code license,
    p.width,
    p.height,
    row_number() OVER (
      PARTITION BY p.location_id
      ORDER BY coalesce(p.is_primary,false) DESC,
               CASE p.source WHEN 'venue' THEN 0 WHEN 'puddle_user' THEN 1 WHEN 'provider' THEN 2 WHEN 'licensed_public' THEN 3 ELSE 9 END,
               coalesce(p.sort_order,0), coalesce(p.verified_at, TIMESTAMP '1970-01-01') DESC
    ) rn
  FROM photo_rows p
  JOIN bootstrap_locations l ON l.id=cast(p.location_id as varchar)
  WHERE p.status='approved' AND coalesce(p.is_ai_generated,false)=false
    AND p.remote_url IS NOT NULL
    AND (p.expires_at IS NULL OR p.expires_at > now())
) WHERE rn=1;
""")
con.execute("""
CREATE OR REPLACE TEMP VIEW verified_google AS
SELECT cast(g.location_id as varchar) location_id, l.country_code,
       cast(g.google_place_id as varchar) google_place_id, try_cast(g.match_score as double) google_place_match_score
FROM google_rows g JOIN bootstrap_locations l ON l.id=cast(g.location_id as varchar)
WHERE g.status='verified' AND g.google_place_id IS NOT NULL;
""")

# Write deterministic per-country overlays so the indexer can stream them without database joins.
for country, in con.execute('SELECT DISTINCT country_code FROM bootstrap_locations ORDER BY country_code').fetchall():
    safe = str(country or 'ZZ').upper()
    con.execute(f"COPY (SELECT location_id,url,provider,attribution,attribution_url,license,width,height FROM primary_photos WHERE country_code='{safe}') TO '{OUT}/country_code={safe}/photo_metadata.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)")
    con.execute(f"COPY (SELECT location_id,google_place_id,google_place_match_score FROM verified_google WHERE country_code='{safe}') TO '{OUT}/country_code={safe}/google_places.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)")

print('bootstrap photo and Google overlays projected into canonical snapshot')
