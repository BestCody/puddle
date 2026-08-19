#!/usr/bin/env python3
"""Shared canonical location-document projection used by search index builders."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass


def first_env(*names: str, default: str = '') -> str:
    for name in names:
        value = str(os.getenv(name, '')).strip()
        if value:
            return value
    return default


def clean_prefix(value: object) -> str:
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


def json_object(value: object) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


@dataclass(frozen=True)
class B2SourceConfig:
    bucket: str
    endpoint_url: str
    endpoint_host: str
    key_id: str
    application_key: str
    region: str
    data_prefix: str


def b2_source_config() -> B2SourceConfig:
    endpoint_url = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
    endpoint_host = endpoint_url.replace('https://', '').replace('http://', '').rstrip('/')
    config = B2SourceConfig(
        bucket=first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets'),
        endpoint_url=endpoint_url,
        endpoint_host=endpoint_host,
        key_id=first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID'),
        application_key=first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY'),
        region=first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005'),
        data_prefix=clean_prefix(first_env('B2_DATA_PREFIX', default='data')),
    )
    if not config.endpoint_host or not config.key_id or not config.application_key:
        raise RuntimeError('B2 endpoint and credentials are required.')
    return config


def configure_duckdb(con, source: B2SourceConfig, threads: int = 8) -> None:
    con.execute('INSTALL httpfs; LOAD httpfs;')
    con.execute('SET preserve_insertion_order=false')
    con.execute(f'SET threads TO {max(1, min(32, int(threads)))}')
    con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
  TYPE S3,
  KEY_ID '{source.key_id.replace("'", "''")}',
  SECRET '{source.application_key.replace("'", "''")}',
  REGION '{source.region.replace("'", "''")}',
  ENDPOINT '{source.endpoint_host.replace("'", "''")}',
  URL_STYLE 'path',
  USE_SSL true
);
""")


def create_canonical_views(con, snapshot: str, source: B2SourceConfig) -> None:
    root = f's3://{source.bucket}/{source.data_prefix}'
    locations_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/locations.parquet'
    photo_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/photo_metadata.parquet'
    enriched_photo_glob = f'{root}/enrichment/photo_metadata/snapshot={snapshot}/country_code=*/*.parquet'
    photo_exclusion_glob = f'{root}/enrichment/photo_exclusions/snapshot={snapshot}/*.parquet'
    google_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/google_places.parquet'

    con.execute(f"CREATE OR REPLACE TEMP VIEW loc AS SELECT * FROM read_parquet('{locations_glob}', union_by_name=true, hive_partitioning=true)")
    photo_sources: list[str] = []
    try:
        con.execute(f"SELECT 1 FROM read_parquet('{photo_glob}', union_by_name=true, hive_partitioning=true) LIMIT 1").fetchall()
        photo_sources.append(f"SELECT location_id,content_hash,provider,attribution,attribution_url,license,width,height,NULL::VARCHAR verified_at FROM read_parquet('{photo_glob}', union_by_name=true, hive_partitioning=true)")
    except Exception:
        pass
    try:
        con.execute(f"SELECT 1 FROM read_parquet('{enriched_photo_glob}', union_by_name=true, hive_partitioning=true) LIMIT 1").fetchall()
        photo_sources.append(f"SELECT location_id,content_hash,provider,attribution,attribution_url,license,width,height,verified_at FROM read_parquet('{enriched_photo_glob}', union_by_name=true, hive_partitioning=true)")
    except Exception:
        pass
    try:
        con.execute(f"CREATE OR REPLACE TEMP VIEW photo_exclusions AS SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash FROM read_parquet('{photo_exclusion_glob}', union_by_name=true)")
        con.execute('SELECT 1 FROM photo_exclusions LIMIT 1').fetchall()
    except Exception:
        con.execute("CREATE OR REPLACE TEMP VIEW photo_exclusions AS SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false")

    if photo_sources:
        con.execute('CREATE OR REPLACE TEMP VIEW photo_union_raw AS ' + ' UNION ALL '.join(photo_sources))
        con.execute("""CREATE OR REPLACE TEMP VIEW photo_union AS
          SELECT p.* FROM photo_union_raw p
          WHERE NOT EXISTS (
            SELECT 1 FROM photo_exclusions x
            WHERE x.location_id=cast(p.location_id AS VARCHAR)
              AND x.content_hash=lower(cast(p.content_hash AS VARCHAR))
          )
        """)
        con.execute("""CREATE OR REPLACE TEMP VIEW photos AS SELECT * EXCLUDE(rn,verified_at) FROM (
          SELECT *,row_number() OVER(PARTITION BY location_id ORDER BY coalesce(try_cast(verified_at AS TIMESTAMP),TIMESTAMP '1970-01-01') DESC,provider) rn
          FROM photo_union
        ) WHERE rn=1""")
    else:
        con.execute("CREATE OR REPLACE TEMP VIEW photos AS SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash,NULL::VARCHAR provider,NULL::VARCHAR attribution,NULL::VARCHAR attribution_url,NULL::VARCHAR license,NULL::INTEGER width,NULL::INTEGER height WHERE false")

    try:
        con.execute(f"CREATE OR REPLACE TEMP VIEW google AS SELECT * FROM read_parquet('{google_glob}', union_by_name=true, hive_partitioning=true)")
        con.execute('SELECT 1 FROM google LIMIT 1').fetchall()
    except Exception:
        con.execute("CREATE OR REPLACE TEMP VIEW google AS SELECT NULL::VARCHAR location_id,NULL::VARCHAR google_place_id,NULL::DOUBLE google_place_match_score WHERE false")


CANONICAL_SQL = """
SELECT
  l.id, l.slug, l.name, []::VARCHAR[] AS aliases, l.summary, NULL::VARCHAR description,
  l.category, NULL::VARCHAR subcategory,
  l.latitude, l.longitude, l.country, l.country_code, l.region, l.region_code, l.city, l.neighborhood,
  l.postal_code, l.address, l.timezone, l.timezone_verified,
  l.opening_hours, l.price_level, l.amenities, l.accessibility,
  coalesce(try_cast(json_extract(l.accessibility, '$.wheelchair_accessible') AS BOOLEAN), false)
    OR coalesce(try_cast(json_extract(l.accessibility, '$.step_free') AS BOOLEAN), false) AS accessible,
  l.website_url, l.phone_public, l.brand_id, l.brand_name, l.source_parent_place_id,
  NULL::VARCHAR duplicate_group_key, NULL::VARCHAR catalogue_group_key,
  l.quality_score, l.popularity_score,
  p.content_hash photo_content_hash, p.provider photo_provider, p.attribution photo_attribution,
  p.attribution_url photo_attribution_url, p.license photo_license, p.width photo_width, p.height photo_height,
  g.google_place_id, g.google_place_match_score,
  l.status, l.updated_at
FROM loc l
LEFT JOIN photos p ON p.location_id=l.id
LEFT JOIN google g ON g.location_id=l.id
"""


def canonical_query(con):
    return con.execute(CANONICAL_SQL)


def canonical_columns(query) -> list[str]:
    return [item[0] for item in query.description]


def document_from_values(columns: list[str], values: tuple) -> dict:
    row = dict(zip(columns, values))
    document = {
        'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'aliases': row['aliases'] or [],
        'summary': row['summary'], 'description': row['description'], 'category': row['category'], 'subcategory': row['subcategory'],
        'location': {'lat': row['latitude'], 'lon': row['longitude']}, 'latitude': row['latitude'], 'longitude': row['longitude'],
        'country': row['country'], 'country_code': row['country_code'], 'region': row['region'], 'region_code': row['region_code'],
        'city': row['city'], 'neighborhood': row['neighborhood'], 'postal_code': row['postal_code'], 'address': row['address'],
        'timezone': row['timezone'], 'timezone_verified': bool(row['timezone_verified']),
        'opening_hours': json_object(row['opening_hours']), 'price_level': row['price_level'], 'amenities': row['amenities'] or [],
        'accessibility': json_object(row['accessibility']), 'accessible': bool(row['accessible']), 'website_url': row['website_url'],
        'phone_public': row['phone_public'], 'brand_id': row['brand_id'], 'brand_name': row['brand_name'],
        'source_parent_place_id': row['source_parent_place_id'], 'duplicate_group_key': row['duplicate_group_key'],
        'catalogue_group_key': row['catalogue_group_key'], 'quality_score': float(row['quality_score'] or 0),
        'popularity_score': float(row['popularity_score'] or 0), 'google_place_id': row['google_place_id'],
        'google_place_match_score': row['google_place_match_score'], 'status': row['status'],
        'updated_at': row['updated_at'].isoformat() if hasattr(row['updated_at'], 'isoformat') else row['updated_at'],
    }
    if row['photo_content_hash']:
        document['primary_photo'] = {
            'content_hash': row['photo_content_hash'], 'provider': row['photo_provider'], 'attribution': row['photo_attribution'],
            'attribution_url': row['photo_attribution_url'], 'license': row['photo_license'],
            'width': row['photo_width'], 'height': row['photo_height']
        }
    return document
