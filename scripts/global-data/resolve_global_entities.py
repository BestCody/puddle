#!/usr/bin/env python3
"""Resolve staged Overture/FSQ rows into canonical Puddle locations.

Existing Puddle UUIDs and slugs from the Supabase bootstrap snapshot win. New
IDs are deterministic UUIDv5 values. Cross-source matches use exact normalized
name/category plus a <=~170m neighborhood candidate search. Ambiguous source
records remain distinct rather than being aggressively merged.
"""
import argparse
import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config


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
parser.add_argument('--countries', default=os.getenv('GLOBAL_LOCATION_COUNTRIES', ''))
args = parser.parse_args()

BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
ENDPOINT = ENDPOINT_URL.replace('https://', '').replace('http://', '')
KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
STAGED_PREFIX = f'{DATA_PREFIX}/staged/places/schema=v1/snapshot={args.snapshot}'
OUTPUT_PREFIX = f'{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}'
NAMESPACE = uuid.UUID(os.getenv('PUDDLE_LOCATION_UUID_NAMESPACE', '4cc1f63b-1a05-5ca2-9f15-5c860930f7d7'))
if not ENDPOINT_URL or not KEY_ID or not KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')

s3 = boto3.client('s3', endpoint_url=ENDPOINT_URL, aws_access_key_id=KEY_ID, aws_secret_access_key=KEY, config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}))


def object_exists(key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception:
        return False


def prefix_exists(prefix):
    return bool(s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix.rstrip('/') + '/', MaxKeys=1).get('KeyCount'))


def country_codes():
    if args.countries.strip():
        return sorted({part.strip().upper() for part in args.countries.split(',') if re.fullmatch(r'[A-Z]{2}|ZZ', part.strip().upper())})
    values = set()
    paginator = s3.get_paginator('list_objects_v2')
    prefix = STAGED_PREFIX.rstrip('/') + '/'
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix, Delimiter='/'):
        for source in page.get('CommonPrefixes', []):
            source_prefix = source['Prefix']
            nested = s3.get_paginator('list_objects_v2')
            for country_page in nested.paginate(Bucket=BUCKET, Prefix=source_prefix, Delimiter='/'):
                for row in country_page.get('CommonPrefixes', []):
                    match = re.search(r'country_code=([^/]+)/$', row['Prefix'])
                    if match:
                        values.add(match.group(1).upper())
    return sorted(values)


def stable_uuid(source, source_id):
    return str(uuid.uuid5(NAMESPACE, f'{source}:{source_id}'))


def slug_base(value):
    value = str(value or '').lower().encode('ascii', 'ignore').decode()
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')[:70]
    return value or 'place'


def stable_slug(name, location_id):
    return f'{slug_base(name)}-{str(location_id).replace("-", "")[:8]}'


countries = country_codes()
if not countries:
    raise RuntimeError(f'No staged country partitions found under s3://{BUCKET}/{STAGED_PREFIX}/')
print(f'resolving {len(countries)} country partitions')

con = duckdb.connect()
con.create_function('puddle_uuid', stable_uuid, ['VARCHAR', 'VARCHAR'], 'VARCHAR')
con.create_function('puddle_slug', stable_slug, ['VARCHAR', 'VARCHAR'], 'VARCHAR')
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(32, int(os.getenv('GLOBAL_RESOLVE_THREADS', '8'))))}")
con.execute(f"SET temp_directory='{os.getenv('DUCKDB_TEMP_DIRECTORY', '.duckdb-tmp').replace("'", "''")}'")
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
  TYPE S3,
  KEY_ID '{KEY_ID.replace("'", "''")}',
  SECRET '{KEY.replace("'", "''")}',
  REGION '{REGION.replace("'", "''")}',
  ENDPOINT '{ENDPOINT.replace("'", "''")}',
  URL_STYLE 'path',
  USE_SSL true
);
""")

bootstrap_prefix = clean_prefix(args.bootstrap_prefix)
bootstrap_locations = f"s3://{BUCKET}/{bootstrap_prefix}/locations.parquet"
bootstrap_links = f"s3://{BUCKET}/{bootstrap_prefix}/location_source_links.parquet"
bootstrap_available = object_exists(f"{bootstrap_prefix}/locations.parquet") and object_exists(f"{bootstrap_prefix}/location_source_links.parquet")
if bootstrap_available:
    con.execute(f"CREATE OR REPLACE TEMP VIEW bootstrap_locations AS SELECT * FROM read_parquet('{bootstrap_locations}')")
    con.execute(f"CREATE OR REPLACE TEMP VIEW bootstrap_links AS SELECT source, cast(source_place_id AS varchar) source_id, cast(location_id AS varchar) location_id FROM read_parquet('{bootstrap_links}')")
else:
    print('warning: bootstrap snapshot not found; all source IDs will receive deterministic new UUIDs')
    con.execute("CREATE OR REPLACE TEMP VIEW bootstrap_locations AS SELECT NULL::VARCHAR id, NULL::VARCHAR slug, NULL::VARCHAR name, NULL::VARCHAR summary, NULL::VARCHAR description, NULL::VARCHAR timezone, NULL::BOOLEAN timezone_verified, NULL::VARCHAR opening_hours, NULL::VARCHAR amenities, NULL::VARCHAR accessibility, NULL::INTEGER price_level, NULL::VARCHAR country, NULL::VARCHAR region_code WHERE false")
    con.execute("CREATE OR REPLACE TEMP VIEW bootstrap_links AS SELECT NULL::VARCHAR source, NULL::VARCHAR source_id, NULL::VARCHAR location_id WHERE false")

summary = {'snapshot': args.snapshot, 'resolvedAt': datetime.now(timezone.utc).isoformat(), 'countries': [], 'locationRows': 0, 'sourceLinks': 0, 'aliases': 0}

for country in countries:
    overture_prefix = f'{STAGED_PREFIX}/source=overture/country_code={country}'
    fsq_prefix = f'{STAGED_PREFIX}/source=fsq_os/country_code={country}'
    has_overture = prefix_exists(overture_prefix)
    has_fsq = prefix_exists(fsq_prefix)
    if not has_overture and not has_fsq:
        continue

    if has_overture:
        con.execute(f"CREATE OR REPLACE TEMP VIEW o AS SELECT * FROM read_parquet('s3://{BUCKET}/{overture_prefix}/*.parquet', union_by_name=true)")
    else:
        con.execute("CREATE OR REPLACE TEMP VIEW o AS SELECT * FROM (VALUES (NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::DOUBLE,NULL::DOUBLE,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::DOUBLE,NULL::TIMESTAMP,NULL::VARCHAR)) t(source,source_id,name,name_key,category,latitude,longitude,country_code,region,city,postal_code,address,website_url,phone_public,brand_id,brand_name,source_parent_place_id,source_confidence,source_updated_at,source_category) WHERE false")
    if has_fsq:
        con.execute(f"CREATE OR REPLACE TEMP VIEW f AS SELECT * FROM read_parquet('s3://{BUCKET}/{fsq_prefix}/*.parquet', union_by_name=true)")
    else:
        con.execute("CREATE OR REPLACE TEMP VIEW f AS SELECT * FROM o WHERE false")

    con.execute("""
    CREATE OR REPLACE TEMP TABLE fsq_match AS
    WITH og AS (
      SELECT *, floor((latitude + 90) * 1000)::BIGINT gy, floor((longitude + 180) * 1000)::BIGINT gx
      FROM o
    ), fg AS (
      SELECT *, floor((latitude + 90) * 1000)::BIGINT gy0, floor((longitude + 180) * 1000)::BIGINT gx0
      FROM f
    ), expanded AS (
      SELECT fg.*, gy0 + dy AS gy, gx0 + dx AS gx
      FROM fg, range(-1, 2) y(dy), range(-1, 2) x(dx)
    ), candidates AS (
      SELECT
        e.source_id fsq_source_id,
        og.source_id overture_source_id,
        ((e.latitude-og.latitude)*(e.latitude-og.latitude) +
         (e.longitude-og.longitude)*(e.longitude-og.longitude)*cos(radians(e.latitude))*cos(radians(e.latitude))) AS d2,
        row_number() OVER (PARTITION BY e.source_id ORDER BY d2, og.source_id) rn
      FROM expanded e
      JOIN og USING (gy, gx)
      WHERE e.name_key = og.name_key
        AND e.category = og.category
        AND abs(e.latitude-og.latitude) <= 0.0015
        AND abs(e.longitude-og.longitude) <= 0.0015
    )
    SELECT fsq_source_id, overture_source_id, d2 FROM candidates WHERE rn=1;
    """)

    con.execute("""
    CREATE OR REPLACE TEMP TABLE canonical_o AS
    WITH known_o AS (
      SELECT source_id, min(location_id) location_id FROM bootstrap_links WHERE source='overture' GROUP BY source_id
    ), known_f AS (
      SELECT source_id, min(location_id) location_id FROM bootstrap_links WHERE source='fsq_os' GROUP BY source_id
    ), matched_known AS (
      SELECT m.overture_source_id, min(k.location_id) location_id
      FROM fsq_match m JOIN known_f k ON k.source_id=m.fsq_source_id
      GROUP BY m.overture_source_id
    )
    SELECT o.*,
      coalesce(ko.location_id, mk.location_id, puddle_uuid('overture', o.source_id)) AS canonical_id
    FROM o
    LEFT JOIN known_o ko USING (source_id)
    LEFT JOIN matched_known mk ON mk.overture_source_id=o.source_id;
    """)
    con.execute("""
    CREATE OR REPLACE TEMP TABLE canonical_f AS
    WITH known_f AS (
      SELECT source_id, min(location_id) location_id FROM bootstrap_links WHERE source='fsq_os' GROUP BY source_id
    )
    SELECT f.*,
      coalesce(co.canonical_id, k.location_id, puddle_uuid('fsq_os', f.source_id)) AS canonical_id,
      m.overture_source_id
    FROM f
    LEFT JOIN fsq_match m ON m.fsq_source_id=f.source_id
    LEFT JOIN canonical_o co ON co.source_id=m.overture_source_id
    LEFT JOIN known_f k ON k.source_id=f.source_id;
    """)

    con.execute("""
    CREATE OR REPLACE TEMP VIEW best_f_for_o AS
    SELECT * EXCLUDE(rn) FROM (
      SELECT f.*, row_number() OVER (
        PARTITION BY overture_source_id
        ORDER BY coalesce(source_confidence,0) DESC, coalesce(source_updated_at, TIMESTAMP '1970-01-01') DESC, source_id
      ) rn
      FROM canonical_f f WHERE overture_source_id IS NOT NULL
    ) WHERE rn=1;
    """)

    con.execute("""
    CREATE OR REPLACE TEMP VIEW canonical_locations AS
    WITH from_o AS (
      SELECT
        co.canonical_id AS id,
        coalesce(bl.slug, puddle_slug(co.name, co.canonical_id)) AS slug,
        coalesce(bl.name, co.name, bf.name) AS name,
        coalesce(bl.summary, bl.description, 'A ' || replace(co.category, '_', ' ') || CASE WHEN co.city IS NOT NULL THEN ' in ' || co.city ELSE '' END || '.') AS summary,
        co.category,
        co.latitude, co.longitude,
        co.country_code,
        coalesce(bl.country, NULL) AS country,
        coalesce(bl.region_code, NULL) AS region_code,
        coalesce(co.region, bf.region) AS region,
        coalesce(co.city, bf.city) AS city,
        NULL::VARCHAR AS neighborhood,
        coalesce(co.postal_code, bf.postal_code) AS postal_code,
        coalesce(co.address, bf.address) AS address,
        coalesce(bl.timezone, NULL) AS timezone,
        coalesce(bl.timezone_verified, false) AS timezone_verified,
        try_cast(bl.opening_hours AS JSON) AS opening_hours,
        try_cast(bl.amenities AS VARCHAR[]) AS amenities,
        try_cast(bl.accessibility AS JSON) AS accessibility,
        try_cast(bl.price_level AS INTEGER) AS price_level,
        coalesce(co.website_url, bf.website_url) AS website_url,
        coalesce(co.phone_public, bf.phone_public) AS phone_public,
        coalesce(co.brand_id, bf.brand_id) AS brand_id,
        coalesce(co.brand_name, bf.brand_name) AS brand_name,
        co.source_parent_place_id,
        coalesce(co.source_confidence, bf.source_confidence, 0.5)::DOUBLE AS quality_score,
        0.0::DOUBLE AS popularity_score,
        'published'::VARCHAR AS status,
        greatest(coalesce(co.source_updated_at, TIMESTAMP '1970-01-01'), coalesce(bf.source_updated_at, TIMESTAMP '1970-01-01')) AS updated_at
      FROM canonical_o co
      LEFT JOIN best_f_for_o bf ON bf.overture_source_id=co.source_id
      LEFT JOIN bootstrap_locations bl ON cast(bl.id AS VARCHAR)=co.canonical_id
    ), unmatched_f AS (
      SELECT
        cf.canonical_id AS id,
        coalesce(bl.slug, puddle_slug(cf.name, cf.canonical_id)) AS slug,
        coalesce(bl.name, cf.name) AS name,
        coalesce(bl.summary, bl.description, 'A ' || replace(cf.category, '_', ' ') || CASE WHEN cf.city IS NOT NULL THEN ' in ' || cf.city ELSE '' END || '.') AS summary,
        cf.category, cf.latitude, cf.longitude, cf.country_code,
        coalesce(bl.country, NULL) AS country,
        coalesce(bl.region_code, NULL) AS region_code,
        cf.region, cf.city, NULL::VARCHAR AS neighborhood, cf.postal_code, cf.address,
        coalesce(bl.timezone, NULL) AS timezone,
        coalesce(bl.timezone_verified, false) AS timezone_verified,
        try_cast(bl.opening_hours AS JSON) AS opening_hours,
        try_cast(bl.amenities AS VARCHAR[]) AS amenities,
        try_cast(bl.accessibility AS JSON) AS accessibility,
        try_cast(bl.price_level AS INTEGER) AS price_level,
        cf.website_url, cf.phone_public, cf.brand_id, cf.brand_name, cf.source_parent_place_id,
        coalesce(cf.source_confidence,0.5)::DOUBLE AS quality_score,
        0.0::DOUBLE AS popularity_score,
        'published'::VARCHAR AS status,
        coalesce(cf.source_updated_at, TIMESTAMP '1970-01-01') AS updated_at
      FROM canonical_f cf
      LEFT JOIN bootstrap_locations bl ON cast(bl.id AS VARCHAR)=cf.canonical_id
      WHERE cf.overture_source_id IS NULL
    )
    SELECT * FROM from_o
    UNION ALL
    SELECT * FROM unmatched_f;
    """)

    con.execute("""
    CREATE OR REPLACE TEMP VIEW source_crosswalk AS
    SELECT 'overture'::VARCHAR source, source_id, canonical_id AS location_id, source_confidence, source_updated_at FROM canonical_o
    UNION ALL
    SELECT 'fsq_os'::VARCHAR source, source_id, canonical_id AS location_id, source_confidence, source_updated_at FROM canonical_f;
    """)
    con.execute("""
    CREATE OR REPLACE TEMP VIEW location_aliases AS
    SELECT DISTINCT b.location_id AS alias_location_id, c.location_id AS canonical_location_id, b.source, b.source_id
    FROM bootstrap_links b
    JOIN source_crosswalk c USING (source, source_id)
    WHERE b.location_id <> c.location_id;
    """)

    country_out = f's3://{BUCKET}/{OUTPUT_PREFIX}/country_code={country}'
    con.execute(f"COPY (SELECT * FROM canonical_locations) TO '{country_out}/locations.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, OVERWRITE_OR_IGNORE true)")
    con.execute(f"COPY (SELECT * FROM source_crosswalk) TO '{country_out}/source_crosswalk.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, OVERWRITE_OR_IGNORE true)")
    con.execute(f"COPY (SELECT * FROM location_aliases) TO '{country_out}/location_aliases.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000, OVERWRITE_OR_IGNORE true)")

    locations = con.execute('SELECT count(*) FROM canonical_locations').fetchone()[0]
    links = con.execute('SELECT count(*) FROM source_crosswalk').fetchone()[0]
    aliases = con.execute('SELECT count(*) FROM location_aliases').fetchone()[0]
    summary['countries'].append({'countryCode': country, 'locations': locations, 'sourceLinks': links, 'aliases': aliases})
    summary['locationRows'] += locations
    summary['sourceLinks'] += links
    summary['aliases'] += aliases
    print(f'{country}: {locations} canonical locations, {links} source links, {aliases} aliases')

manifest_key = f'{OUTPUT_PREFIX}/manifest.json'
s3.put_object(Bucket=BUCKET, Key=manifest_key, Body=(json.dumps(summary, indent=2) + '\n').encode(), ContentType='application/json')
print(json.dumps(summary, indent=2))
