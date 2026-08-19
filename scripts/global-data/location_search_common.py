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


def _parquet_columns(con, glob: str, *, hive_partitioning: bool = True) -> set[str]:
    """Read Parquet metadata only; optional historical overlays are allowed to differ."""
    hive = 'true' if hive_partitioning else 'false'
    try:
        rows = con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{glob}', union_by_name=true, hive_partitioning={hive})"
        ).fetchall()
        return {str(row[0]) for row in rows}
    except Exception:
        return set()


def _optional_column(columns: set[str], name: str, sql_type: str) -> str:
    return name if name in columns else f'NULL::{sql_type} AS {name}'


def _photo_source_sql(glob: str, columns: set[str], *, hive_partitioning: bool = True) -> str | None:
    if not {'location_id', 'content_hash'}.issubset(columns):
        return None
    hive = 'true' if hive_partitioning else 'false'
    projection = [
        'location_id',
        'content_hash',
        _optional_column(columns, 'provider', 'VARCHAR'),
        _optional_column(columns, 'attribution', 'VARCHAR'),
        _optional_column(columns, 'attribution_url', 'VARCHAR'),
        _optional_column(columns, 'license', 'VARCHAR'),
        _optional_column(columns, 'width', 'INTEGER'),
        _optional_column(columns, 'height', 'INTEGER'),
        _optional_column(columns, 'verified_at', 'VARCHAR'),
    ]
    return (
        f"SELECT {','.join(projection)} FROM read_parquet("
        f"'{glob}', union_by_name=true, hive_partitioning={hive})"
    )


def create_canonical_views(con, snapshot: str, source: B2SourceConfig) -> None:
    root = f's3://{source.bucket}/{source.data_prefix}'
    locations_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/locations.parquet'
    photo_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/photo_metadata.parquet'
    enriched_photo_glob = f'{root}/enrichment/photo_metadata/snapshot={snapshot}/country_code=*/*.parquet'
    photo_exclusion_glob = f'{root}/enrichment/photo_exclusions/snapshot={snapshot}/*.parquet'
    google_glob = f'{root}/normalized/schema=v1/snapshot={snapshot}/country_code=*/google_places.parquet'

    con.execute(f"CREATE OR REPLACE TEMP VIEW loc AS SELECT * FROM read_parquet('{locations_glob}', union_by_name=true, hive_partitioning=true)")

    # Slugs are public lookup keys and therefore must be one-to-one with canonical IDs.
    # Historical generated slugs used only the first eight UUID hex digits, so collisions
    # are possible at global scale. Detect only duplicate keys once, preserve the original
    # slug for the lexicographically-smallest ID, and suffix conflicting rows with their
    # full UUID. This keeps all non-conflicting URLs stable while making the projection
    # deterministic and collision-safe for old snapshots.
    con.execute("""
CREATE OR REPLACE TEMP TABLE slug_collision_winners AS
SELECT
  cast(slug AS VARCHAR) AS slug,
  min(cast(id AS VARCHAR)) AS winner_id
FROM loc
WHERE slug IS NOT NULL AND trim(cast(slug AS VARCHAR)) <> ''
GROUP BY 1
HAVING count(*) > 1
""")
    collision_count = con.execute('SELECT count(*) FROM slug_collision_winners').fetchone()[0]
    if collision_count:
        print(f'search projection: resolving {collision_count} duplicate canonical slug keys', flush=True)

    photo_sources: list[str] = []
    normalized_photo_columns = _parquet_columns(con, photo_glob)
    normalized_photo_sql = _photo_source_sql(photo_glob, normalized_photo_columns)
    if normalized_photo_sql:
        photo_sources.append(normalized_photo_sql)
    elif normalized_photo_columns:
        print(
            'search projection: ignoring incompatible historical normalized photo_metadata schema '
            f'columns={sorted(normalized_photo_columns)}',
            flush=True,
        )

    enriched_photo_columns = _parquet_columns(con, enriched_photo_glob)
    enriched_photo_sql = _photo_source_sql(enriched_photo_glob, enriched_photo_columns)
    if enriched_photo_sql:
        photo_sources.append(enriched_photo_sql)
    elif enriched_photo_columns:
        print(
            'search projection: ignoring incompatible photo enrichment schema '
            f'columns={sorted(enriched_photo_columns)}',
            flush=True,
        )

    exclusion_columns = _parquet_columns(con, photo_exclusion_glob, hive_partitioning=False)
    if {'location_id', 'content_hash'}.issubset(exclusion_columns):
        con.execute(
            f"CREATE OR REPLACE TEMP VIEW photo_exclusions AS "
            f"SELECT cast(location_id AS VARCHAR) location_id,lower(cast(content_hash AS VARCHAR)) content_hash "
            f"FROM read_parquet('{photo_exclusion_glob}', union_by_name=true)"
        )
    else:
        con.execute(
            "CREATE OR REPLACE TEMP VIEW photo_exclusions AS "
            "SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash WHERE false"
        )

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
          SELECT *,row_number() OVER(
            PARTITION BY location_id
            ORDER BY coalesce(try_cast(verified_at AS TIMESTAMP),TIMESTAMP '1970-01-01') DESC,provider,content_hash
          ) rn
          FROM photo_union
        ) WHERE rn=1""")
    else:
        con.execute(
            "CREATE OR REPLACE TEMP VIEW photos AS "
            "SELECT NULL::VARCHAR location_id,NULL::VARCHAR content_hash,NULL::VARCHAR provider,"
            "NULL::VARCHAR attribution,NULL::VARCHAR attribution_url,NULL::VARCHAR license,"
            "NULL::INTEGER width,NULL::INTEGER height WHERE false"
        )

    google_columns = _parquet_columns(con, google_glob)
    if {'location_id', 'google_place_id'}.issubset(google_columns):
        google_projection = [
            'location_id',
            'google_place_id',
            _optional_column(google_columns, 'google_place_match_score', 'DOUBLE'),
        ]
        con.execute(
            f"CREATE OR REPLACE TEMP VIEW google AS SELECT {','.join(google_projection)} "
            f"FROM read_parquet('{google_glob}', union_by_name=true, hive_partitioning=true)"
        )
    else:
        if google_columns:
            print(
                'search projection: ignoring incompatible historical google_places schema '
                f'columns={sorted(google_columns)}',
                flush=True,
            )
        con.execute(
            "CREATE OR REPLACE TEMP VIEW google AS "
            "SELECT NULL::VARCHAR location_id,NULL::VARCHAR google_place_id,"
            "NULL::DOUBLE google_place_match_score WHERE false"
        )


CANONICAL_SQL = """
SELECT
  l.id,
  CASE
    WHEN sc.slug IS NOT NULL AND cast(l.id AS VARCHAR) <> sc.winner_id
      THEN cast(l.slug AS VARCHAR) || '-' || replace(cast(l.id AS VARCHAR), '-', '')
    ELSE l.slug
  END AS slug,
  l.name, []::VARCHAR[] AS aliases, l.summary, NULL::VARCHAR description,
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
LEFT JOIN slug_collision_winners sc ON sc.slug=cast(l.slug AS VARCHAR)
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
