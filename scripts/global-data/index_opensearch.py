#!/usr/bin/env python3
"""Build a blue/green OpenSearch location index from canonical B2 Parquet and atomically swap the active alias."""
import argparse
import base64
import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
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
parser.add_argument('--alias', default=os.getenv('GLOBAL_LOCATION_SEARCH_INDEX', 'locations-active'))
parser.add_argument('--batch-size', type=int, default=int(os.getenv('OPENSEARCH_BULK_BATCH_SIZE', '2000')))
args = parser.parse_args()

ENDPOINT = (first_env('GLOBAL_LOCATION_SEARCH_URL', 'OPENSEARCH_URL')).rstrip('/')
if not ENDPOINT:
    raise RuntimeError('GLOBAL_LOCATION_SEARCH_URL or OPENSEARCH_URL is required.')
if not (ENDPOINT.startswith('https://') or ENDPOINT.startswith('http://localhost') or ENDPOINT.startswith('http://127.0.0.1')):
    raise RuntimeError('OpenSearch endpoint must use HTTPS outside local development.')

BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
B2_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
B2_ENDPOINT = B2_ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
B2_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
B2_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
B2_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not B2_ENDPOINT or not B2_KEY_ID or not B2_KEY:
    raise RuntimeError('B2 endpoint and credentials are required.')
INDEX = re.sub(r'[^a-z0-9_.-]+', '-', f'locations-v1-{args.snapshot.lower()}-{int(time.time())}')[:200]
BATCH = max(100, min(10_000, args.batch_size))


def json_object(value):
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


def headers(content_type='application/json'):
    result = {'Accept': 'application/json', 'Content-Type': content_type}
    bearer = os.getenv('OPENSEARCH_BEARER_TOKEN', '').strip()
    user = os.getenv('OPENSEARCH_USERNAME', '').strip()
    password = os.getenv('OPENSEARCH_PASSWORD', '').strip()
    if bearer:
        result['Authorization'] = f'Bearer {bearer}'
    elif user or password:
        if not user or not password:
            raise RuntimeError('Both OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD are required.')
        result['Authorization'] = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()
    return result


def request(method, path, payload=None, content_type='application/json', retries=5):
    body = None
    extra_headers = headers(content_type)
    if payload is not None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(f'{ENDPOINT}{path}', data=body, method=method, headers=extra_headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read().decode(errors='replace')[:1000]
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt + 1 >= retries:
                raise RuntimeError(f'OpenSearch {method} {path} failed with {error.code}: {raw}') from error
            delay = min(30, int(error.headers.get('Retry-After', '0') or 0) or (2 ** attempt))
            time.sleep(delay)
    raise RuntimeError('OpenSearch request exhausted retries.')


mapping = {
    'settings': {
        'number_of_shards': int(os.getenv('OPENSEARCH_LOCATION_SHARDS', '6')),
        'number_of_replicas': int(os.getenv('OPENSEARCH_LOCATION_REPLICAS', '2')),
        'refresh_interval': '-1',
        'index.mapping.total_fields.limit': 1000,
    },
    'mappings': {
        'dynamic': 'strict',
        'properties': {
            'id': {'type': 'keyword'}, 'slug': {'type': 'keyword'},
            'name': {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 512}}},
            'aliases': {'type': 'text'}, 'summary': {'type': 'text'}, 'description': {'type': 'text'},
            'category': {'type': 'keyword'}, 'subcategory': {'type': 'keyword'},
            'location': {'type': 'geo_point'}, 'latitude': {'type': 'double'}, 'longitude': {'type': 'double'},
            'country': {'type': 'keyword'}, 'country_code': {'type': 'keyword'},
            'region': {'type': 'keyword'}, 'region_code': {'type': 'keyword'}, 'city': {'type': 'keyword'},
            'neighborhood': {'type': 'keyword'}, 'postal_code': {'type': 'keyword'}, 'address': {'type': 'text'},
            'timezone': {'type': 'keyword'}, 'timezone_verified': {'type': 'boolean'},
            'opening_hours': {'type': 'object', 'enabled': False}, 'price_level': {'type': 'byte'}, 'amenities': {'type': 'keyword'},
            'accessibility': {'type': 'object', 'enabled': False}, 'accessible': {'type': 'boolean'},
            'website_url': {'type': 'keyword', 'index': False}, 'phone_public': {'type': 'keyword', 'index': False},
            'brand_id': {'type': 'keyword'}, 'brand_name': {'type': 'keyword'},
            'source_parent_place_id': {'type': 'keyword'}, 'duplicate_group_key': {'type': 'keyword'},
            'catalogue_group_key': {'type': 'keyword'}, 'quality_score': {'type': 'float'},
            'popularity_score': {'type': 'float'}, 'google_place_id': {'type': 'keyword'},
            'google_place_match_score': {'type': 'float'}, 'primary_photo': {
                'properties': {
                    'content_hash': {'type': 'keyword'}, 'provider': {'type': 'keyword'},
                    'attribution': {'type': 'keyword', 'index': False}, 'attribution_url': {'type': 'keyword', 'index': False},
                    'license': {'type': 'keyword'}, 'width': {'type': 'integer'}, 'height': {'type': 'integer'}
                }
            },
            'status': {'type': 'keyword'}, 'updated_at': {'type': 'date'}
        }
    }
}

request('PUT', f'/{INDEX}', mapping)
print(f'created {INDEX}', flush=True)

con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"SET threads TO {max(1, min(32, int(os.getenv('OPENSEARCH_INDEX_THREADS', '8'))))}")
con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
  TYPE S3,
  KEY_ID '{B2_KEY_ID.replace("'", "''")}',
  SECRET '{B2_KEY.replace("'", "''")}',
  REGION '{B2_REGION.replace("'", "''")}',
  ENDPOINT '{B2_ENDPOINT.replace("'", "''")}',
  URL_STYLE 'path',
  USE_SSL true
);
""")

locations_glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet'
photo_glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/photo_metadata.parquet'
enriched_photo_glob = f's3://{BUCKET}/{DATA_PREFIX}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code=*/*.parquet'
photo_exclusion_glob = f's3://{BUCKET}/{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={args.snapshot}/*.parquet'
google_glob = f's3://{BUCKET}/{DATA_PREFIX}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/google_places.parquet'

con.execute(f"CREATE OR REPLACE TEMP VIEW loc AS SELECT * FROM read_parquet('{locations_glob}', union_by_name=true, hive_partitioning=true)")
photo_sources = []
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
    con.execute("CREATE OR REPLACE TEMP VIEW photo_union_raw AS " + " UNION ALL ".join(photo_sources))
    con.execute("""CREATE OR REPLACE TEMP VIEW photo_union AS
      SELECT p.*
      FROM photo_union_raw p
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

query = con.execute("""
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
ORDER BY l.id
""")
columns = [item[0] for item in query.description]
indexed = 0
failed = 0
sample_document = None

while True:
    rows = query.fetchmany(BATCH)
    if not rows:
        break
    lines = []
    for values in rows:
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
        if sample_document is None:
            sample_document = document
        lines.append(json.dumps({'index': {'_index': INDEX, '_id': row['id']}}, separators=(',', ':')))
        lines.append(json.dumps(document, separators=(',', ':'), default=str))
    raw = ('\n'.join(lines) + '\n').encode()
    compressed = gzip.compress(raw, compresslevel=1)
    hdr = headers('application/x-ndjson')
    hdr['Content-Encoding'] = 'gzip'
    response = None
    for attempt in range(5):
        req = urllib.request.Request(f'{ENDPOINT}/_bulk', data=compressed, method='POST', headers=hdr)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                response = json.loads(res.read())
            break
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors='replace')[:1000]
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 4:
                raise RuntimeError(f'OpenSearch bulk failed {error.code}: {body}') from error
            time.sleep(min(30, 2 ** attempt))
    items = response.get('items', [])
    batch_failed = sum(1 for item in items if item.get('index', {}).get('status', 500) >= 300)
    indexed += len(rows) - batch_failed
    failed += batch_failed
    print(f'indexed={indexed} failed={failed}', flush=True)
    if batch_failed:
        sample = [item for item in items if item.get('index', {}).get('status', 500) >= 300][:5]
        raise RuntimeError(f'OpenSearch bulk batch contained {batch_failed} failures: {json.dumps(sample)[:2000]}')

request('POST', f'/{INDEX}/_refresh')
count = request('GET', f'/{INDEX}/_count').get('count', 0)
if int(count) != indexed or failed:
    raise RuntimeError(f'Index validation failed: OpenSearch count={count}, locally indexed={indexed}, failed={failed}.')
if indexed <= 0 or sample_document is None:
    raise RuntimeError('Index validation failed: canonical snapshot produced no searchable documents.')

# Exercise the same classes of query the runtime depends on before the alias can move.
sample_id = urllib.parse.quote(str(sample_document['id']), safe='')
lookup = request('GET', f'/{INDEX}/_doc/{sample_id}')
if not lookup.get('found'):
    raise RuntimeError('Index validation failed: sample ID lookup was not found.')
name_check = request('POST', f'/{INDEX}/_search', {'size': 1, 'query': {'match': {'name': sample_document['name']}}})
if int(name_check.get('hits', {}).get('total', {}).get('value', 0)) < 1:
    raise RuntimeError('Index validation failed: sample text query returned no results.')
category = sample_document.get('category')
if category:
    category_check = request('POST', f'/{INDEX}/_search', {'size': 1, 'query': {'term': {'category': category}}})
    if int(category_check.get('hits', {}).get('total', {}).get('value', 0)) < 1:
        raise RuntimeError('Index validation failed: sample category query returned no results.')
location = sample_document.get('location') or {}
geo_validated = False
if location.get('lat') is not None and location.get('lon') is not None:
    geo_check = request('POST', f'/{INDEX}/_search', {
        'size': 1,
        'query': {'bool': {'filter': {'geo_distance': {'distance': '1km', 'location': location}}}},
    })
    if int(geo_check.get('hits', {}).get('total', {}).get('value', 0)) < 1:
        raise RuntimeError('Index validation failed: sample geo-radius query returned no results.')
    geo_validated = True

request('PUT', f'/{INDEX}/_settings', {'index': {'refresh_interval': os.getenv('OPENSEARCH_REFRESH_INTERVAL', '30s')}})

settings = request('GET', f'/{INDEX}/_settings')
index_settings = settings.get(INDEX, {}).get('settings', {}).get('index', {})
shards = int(index_settings.get('number_of_shards', 0))
replicas = int(index_settings.get('number_of_replicas', -1))
expected_shards = int(os.getenv('OPENSEARCH_LOCATION_SHARDS', '6'))
expected_replicas = int(os.getenv('OPENSEARCH_LOCATION_REPLICAS', '2'))
if shards != expected_shards:
    raise RuntimeError(f'Index validation failed: expected {expected_shards} primary shards, got {shards}.')
if replicas != expected_replicas:
    raise RuntimeError(f'Index validation failed: expected {expected_replicas} replicas, got {replicas}.')
health = request('GET', f'/_cluster/health/{INDEX}')
health_status = str(health.get('status', '')).lower()
if health_status == 'red' or not health_status:
    raise RuntimeError(f'Index validation failed: unacceptable cluster health: {json.dumps(health)[:2000]}')

# Atomically remove the production alias from any previous blue/green index and
# add it to the newly validated index. Avoid GET /_alias/<name>: the production
# indexer role can manage aliases, but that introspection endpoint is not granted.
actions = [
    {'remove': {'index': 'locations-v1-*', 'alias': args.alias, 'must_exist': False}},
    {'add': {'index': INDEX, 'alias': args.alias}},
]
request('POST', '/_aliases', {'actions': actions})

# Validate production through the serving alias itself before publishing B2's
# active pointer. This tests the same path the application will use.
alias_name = urllib.parse.quote(args.alias, safe='-_.')
alias_count = int(request('GET', f'/{alias_name}/_count').get('count', -1))
if alias_count != indexed:
    raise RuntimeError(f'OpenSearch alias validation failed: alias count={alias_count}, indexed={indexed}.')
alias_search = request('POST', f'/{alias_name}/_search', {'size': 1, 'query': {'match_all': {}}})
if not alias_search.get('hits', {}).get('hits'):
    raise RuntimeError('OpenSearch alias validation failed: production search returned no documents.')

active = {
    'index': INDEX,
    'alias': args.alias,
    'documents': indexed,
    'snapshot': args.snapshot,
    'activatedAt': datetime.now(timezone.utc).isoformat(),
    'validation': {
        'count': True,
        'idLookup': True,
        'text': True,
        'category': bool(category),
        'geo': geo_validated,
        'aliasCount': True,
        'aliasSearch': True,
        'shards': shards,
        'replicas': replicas,
        'health': health_status,
    },
}
b2 = boto3.client(
    's3', endpoint_url=B2_ENDPOINT_URL, aws_access_key_id=B2_KEY_ID, aws_secret_access_key=B2_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)
b2.put_object(
    Bucket=BUCKET,
    Key=f'{DATA_PREFIX}/manifests/active-location-snapshot.json',
    Body=(json.dumps(active, indent=2) + '\n').encode(),
    ContentType='application/json',
)
print(json.dumps(active, indent=2), flush=True)
