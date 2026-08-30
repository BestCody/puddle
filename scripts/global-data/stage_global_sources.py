#!/usr/bin/env python3
"""Vectorize Overture + FSQ raw datasets into a common, partitioned source schema in B2.

This stage deliberately keeps source rows separate. Entity resolution happens in
resolve_global_entities.py so the raw lake and source-normalized lake are always rebuildable.
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
parser.add_argument('--overture-release', default=os.getenv('OVERTURE_RELEASE', ''))
parser.add_argument('--fsq-release', default=os.getenv('FSQ_RELEASE_LABEL', ''))
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
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
if not args.overture_release or not args.fsq_release:
    raise RuntimeError('Set --overture-release and --fsq-release to mirrored B2 release labels.')

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET preserve_insertion_order=false")
con.execute(f"SET threads TO {max(1, min(32, int(os.getenv('GLOBAL_STAGE_THREADS', '8'))))}")
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


def columns(path):
    return {row[0] for row in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}', union_by_name=true, hive_partitioning=true) LIMIT 0").fetchall()}


def expr(cols, name, expression, fallback='NULL'):
    return expression if name in cols else fallback


def category_case(raw_expr):
    # Overture supplies snake_case categories while Foursquare labels arrive as human text
    # ("Fire Station", "Dining and Drinking > Bar"), so every separator is normalised to a single
    # underscore before matching. Without this the underscore spellings below silently never
    # matched Foursquare rows, which is how fire stations reached the bar category.
    value = (
        "regexp_replace(lower(coalesce(cast(" + str(raw_expr) + " as varchar), '')), "
        "'[^a-z0-9]+', '_', 'g')"
    )
    # Retail categories are excluded ahead of the venue rules because several of them collide
    # with venue words. Home improvement chains are filed under "home_and_garden", and the park
    # rule below matches on garden, which classified hardware stores as parks across every city.
    excluded = (
        "hospital|clinic|medical|dentist|school|university|college|office|warehouse|factory"
        "|police|fire_station|private_residence|government_office"
        "|hardware|home_improvement|home_(and_)?garden|garden_cent|building_suppl|building_cent"
        "|lumber|plumbing|electrical_suppl|wholesale|self_storage|car_park|parking"
        # "marketing_agency" is not a market. The shop rule matches market unanchored so that
        # supermarket and flea_market still land there, so the exclusion carries this instead.
        "|marketing"
    )
    return f"""
    CASE
      WHEN regexp_matches({value}, '{excluded}') THEN NULL
      WHEN regexp_matches({value}, 'cafe|coffee|tea_house|tea_room|bakery|dessert|ice_cream|gelato|donut') THEN 'cafe'
      WHEN regexp_matches({value}, 'nightclub|night_club|dance_club|karaoke') THEN 'nightlife'
      WHEN regexp_matches({value}, '(^|_)(bar|pub|brewpub|beer_garden|wine_bar|cocktail_bar|sports_bar|lounge)(_|$)') THEN 'bar'
      WHEN regexp_matches({value}, 'arcade|bowling|miniature_golf|mini_golf|escape_room|recreation|sports_center|sports_centre|climbing_gym|trampoline|game_center|game_centre|clubhouse') THEN 'activity_venue'
      WHEN regexp_matches({value}, 'community_center|community_centre|community_space|cultural_center|cultural_centre|public_hall|social_center') THEN 'community_space'
      -- Ticketed park-named attractions are matched ahead of the park rule. They are already
      -- listed under attraction below, but a rule ending in _park claims them first, which files
      -- theme parks and water parks alongside municipal green space.
      WHEN regexp_matches({value}, '(^|_)(amusement_park|theme_park|water_park|trampoline_park|adventure_park)(_|$)') THEN 'attraction'
      WHEN regexp_matches({value}, '(^|_)(park|garden|playground|nature_reserve|dog_park|waterfront_park)(_|$)') THEN 'park'
      WHEN regexp_matches({value}, 'museum') THEN 'museum'
      WHEN regexp_matches({value}, 'gallery') THEN 'gallery'
      WHEN regexp_matches({value}, 'cinema|movie_theat|theater|theatre|aquarium|zoo|tourist_attraction|amusement_park|theme_park|planetarium') THEN 'attraction'
      WHEN regexp_matches({value}, 'viewpoint|scenic|landmark|historic|monument|memorial|observation_deck|waterfront') THEN 'scenic_spot'
      WHEN regexp_matches({value}, 'bookstore|book_shop|market|shopping_mall|shopping_center|shopping_centre|department_store|gift_shop|record_store|game_store|toy_store') THEN 'shop'
      WHEN regexp_matches({value}, 'restaurant|food_court|fine_dining|fast_food|dining|eat_and_drink|_restaurant') THEN 'restaurant'
      ELSE NULL
    END
    """


def clean_name(expression):
    return f"nullif(trim(regexp_replace(cast({expression} as varchar), '\\s+', ' ', 'g')), '')"


def name_key(expression):
    return f"regexp_replace(lower(coalesce({expression}, '')), '[^a-z0-9]+', '', 'g')"


def safe_country(expression):
    return f"CASE WHEN regexp_matches(upper(coalesce(cast({expression} as varchar), '')), '^[A-Z]{{2}}$') THEN upper(cast({expression} as varchar)) ELSE 'ZZ' END"


out_root = f"s3://{BUCKET}/{DATA_PREFIX}/staged/places/schema=v1/snapshot={args.snapshot}"

overture_path = f"s3://{BUCKET}/{DATA_PREFIX}/raw/overture/release={args.overture_release}/theme=places/type=place/**/*.parquet"
o_cols = columns(overture_path)
for required in ('id', 'names', 'geometry'):
    if required not in o_cols:
        raise RuntimeError(f'Overture schema is missing required top-level column {required}.')

basic_category = expr(o_cols, 'basic_category', 'basic_category', expr(o_cols, 'categories', 'categories.primary', "''"))
country = expr(o_cols, 'addresses', 'addresses[1].country', "''")
region = expr(o_cols, 'addresses', 'addresses[1].region', 'NULL')
city = expr(o_cols, 'addresses', 'addresses[1].locality', 'NULL')
postal = expr(o_cols, 'addresses', 'addresses[1].postcode', 'NULL')
address = expr(o_cols, 'addresses', 'addresses[1].freeform', 'NULL')
web = expr(o_cols, 'websites', 'websites[1]', 'NULL')
phone = expr(o_cols, 'phones', 'phones[1]', 'NULL')
confidence = expr(o_cols, 'confidence', 'try_cast(confidence as double)', 'NULL')
status = expr(o_cols, 'operating_status', 'lower(cast(operating_status as varchar))', "''")
updated = expr(o_cols, 'sources', "try_cast(list_max(list_transform(sources, x -> x.update_time)) as timestamp)", 'NULL')
brand_id = expr(o_cols, 'brand', 'cast(brand.wikidata as varchar)', 'NULL')
brand_name = expr(o_cols, 'brand', 'cast(brand.names.primary as varchar)', 'NULL')
parent_id = expr(o_cols, 'categories', 'NULL', 'NULL')
name = clean_name('names.primary')
category = category_case(basic_category)

con.execute(f"""
CREATE OR REPLACE TEMP VIEW staged_overture AS
SELECT
  'overture'::VARCHAR AS source,
  cast(id AS VARCHAR) AS source_id,
  {name} AS name,
  {name_key(name)} AS name_key,
  {category} AS category,
  ST_Y(geometry)::DOUBLE AS latitude,
  ST_X(geometry)::DOUBLE AS longitude,
  {safe_country(country)} AS country_code,
  {clean_name(region)} AS region,
  {clean_name(city)} AS city,
  {clean_name(postal)} AS postal_code,
  {clean_name(address)} AS address,
  {clean_name(web)} AS website_url,
  {clean_name(phone)} AS phone_public,
  {clean_name(brand_id)} AS brand_id,
  {clean_name(brand_name)} AS brand_name,
  {parent_id}::VARCHAR AS source_parent_place_id,
  {confidence}::DOUBLE AS source_confidence,
  {updated} AS source_updated_at,
  cast({basic_category} as varchar) AS source_category
FROM read_parquet('{overture_path}', union_by_name=true, hive_partitioning=true)
WHERE {name} IS NOT NULL
  AND {category} IS NOT NULL
  AND ST_Y(geometry) BETWEEN -90 AND 90
  AND ST_X(geometry) BETWEEN -180 AND 180
  AND {status} NOT IN ('closed', 'inactive', 'temporarily_closed', 'permanently_closed');
""")
con.execute(f"""
COPY (SELECT * FROM staged_overture)
TO '{out_root}'
(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PARTITION_BY (source, country_code), OVERWRITE_OR_IGNORE true);
""")
print('staged Overture')

fsq_path = f"s3://{BUCKET}/{DATA_PREFIX}/raw/fsq/release={args.fsq_release}/places/**/*.parquet"
f_cols = columns(fsq_path)
fsq_id_col = 'fsq_place_id' if 'fsq_place_id' in f_cols else 'id' if 'id' in f_cols else None
if not fsq_id_col or 'name' not in f_cols or 'latitude' not in f_cols or 'longitude' not in f_cols:
    raise RuntimeError('FSQ schema must contain an ID, name, latitude, and longitude.')
labels = 'array_to_string(fsq_category_labels, \' | \')' if 'fsq_category_labels' in f_cols else expr(f_cols, 'categories', 'cast(categories as varchar)', "''")
country = expr(f_cols, 'country', 'country', "''")
region = expr(f_cols, 'region', 'region', 'NULL')
city = expr(f_cols, 'locality', 'locality', expr(f_cols, 'city', 'city', 'NULL'))
postal = expr(f_cols, 'postcode', 'postcode', expr(f_cols, 'postal_code', 'postal_code', 'NULL'))
address = expr(f_cols, 'address', 'address', 'NULL')
web = expr(f_cols, 'website', 'website', 'NULL')
phone = expr(f_cols, 'tel', 'tel', expr(f_cols, 'phone', 'phone', 'NULL'))
brand_id = expr(f_cols, 'fsq_chain_id', 'fsq_chain_id', 'NULL')
brand_name = expr(f_cols, 'fsq_chain_name', 'fsq_chain_name', 'NULL')
parent_id = expr(f_cols, 'parent_id', 'parent_id', 'NULL')
confidence = expr(f_cols, 'confidence', 'try_cast(confidence as double)', 'NULL')
updated = expr(f_cols, 'date_refreshed', 'try_cast(date_refreshed as timestamp)', expr(f_cols, 'updated_at', 'try_cast(updated_at as timestamp)', 'NULL'))
closed = expr(f_cols, 'date_closed', 'date_closed IS NOT NULL', 'false')
f_name = clean_name('name')
f_category = category_case(labels)

con.execute(f"""
CREATE OR REPLACE TEMP VIEW staged_fsq AS
SELECT
  'fsq_os'::VARCHAR AS source,
  cast({fsq_id_col} AS VARCHAR) AS source_id,
  {f_name} AS name,
  {name_key(f_name)} AS name_key,
  {f_category} AS category,
  try_cast(latitude AS DOUBLE) AS latitude,
  try_cast(longitude AS DOUBLE) AS longitude,
  {safe_country(country)} AS country_code,
  {clean_name(region)} AS region,
  {clean_name(city)} AS city,
  {clean_name(postal)} AS postal_code,
  {clean_name(address)} AS address,
  {clean_name(web)} AS website_url,
  {clean_name(phone)} AS phone_public,
  {clean_name(brand_id)} AS brand_id,
  {clean_name(brand_name)} AS brand_name,
  {clean_name(parent_id)} AS source_parent_place_id,
  {confidence}::DOUBLE AS source_confidence,
  {updated} AS source_updated_at,
  cast({labels} as varchar) AS source_category
FROM read_parquet('{fsq_path}', union_by_name=true, hive_partitioning=true)
WHERE {f_name} IS NOT NULL
  AND {f_category} IS NOT NULL
  AND try_cast(latitude AS DOUBLE) BETWEEN -90 AND 90
  AND try_cast(longitude AS DOUBLE) BETWEEN -180 AND 180
  AND NOT ({closed});
""")
con.execute(f"""
COPY (SELECT * FROM staged_fsq)
TO '{out_root}'
(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PARTITION_BY (source, country_code), OVERWRITE_OR_IGNORE true);
""")
print('staged FSQ OS')

manifest = {
    'schemaVersion': 1,
    'snapshot': args.snapshot,
    'overtureRelease': args.overture_release,
    'fsqRelease': args.fsq_release,
    'stagedAt': datetime.now(timezone.utc).isoformat(),
    'prefix': out_root,
}
manifest_json = __import__('json').dumps(manifest).replace("'", "''")
con.execute(f"COPY (SELECT '{manifest_json}' AS json) TO '{out_root}/_manifest.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)")
print(__import__('json').dumps(manifest, indent=2))
