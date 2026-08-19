#!/usr/bin/env python3
"""Migration-only OpenSearch builder using the same canonical document projection as B2 search."""
from __future__ import annotations

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

import duckdb

from location_search_common import (
    b2_source_config,
    canonical_columns,
    canonical_query,
    configure_duckdb,
    create_canonical_views,
    document_from_values,
    first_env,
)


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
    parser.add_argument('--alias', default=os.getenv('GLOBAL_LOCATION_SEARCH_INDEX', 'locations-active'))
    parser.add_argument('--batch-size', type=int, default=int(os.getenv('OPENSEARCH_BULK_BATCH_SIZE', '2000')))
    args = parser.parse_args()

    endpoint = first_env('GLOBAL_LOCATION_SEARCH_URL', 'OPENSEARCH_URL').rstrip('/')
    if not endpoint:
        raise RuntimeError('GLOBAL_LOCATION_SEARCH_URL or OPENSEARCH_URL is required.')
    if not (endpoint.startswith('https://') or endpoint.startswith('http://localhost') or endpoint.startswith('http://127.0.0.1')):
        raise RuntimeError('OpenSearch endpoint must use HTTPS outside local development.')
    index = re.sub(r'[^a-z0-9_.-]+', '-', f'locations-v1-{args.snapshot.lower()}-{int(time.time())}')[:200]
    batch = max(100, min(10_000, int(args.batch_size)))

    def request(method, path, payload=None, content_type='application/json', retries=5):
        body = payload if isinstance(payload, bytes) else (json.dumps(payload).encode() if payload is not None else None)
        for attempt in range(retries):
            req = urllib.request.Request(f'{endpoint}{path}', data=body, method=method, headers=headers(content_type))
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
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
                'google_place_match_score': {'type': 'float'},
                'primary_photo': {'properties': {
                    'content_hash': {'type': 'keyword'}, 'provider': {'type': 'keyword'},
                    'attribution': {'type': 'keyword', 'index': False}, 'attribution_url': {'type': 'keyword', 'index': False},
                    'license': {'type': 'keyword'}, 'width': {'type': 'integer'}, 'height': {'type': 'integer'}
                }},
                'status': {'type': 'keyword'}, 'updated_at': {'type': 'date'}
            }
        }
    }
    request('PUT', f'/{index}', mapping)
    print(f'created {index}', flush=True)

    source = b2_source_config()
    con = duckdb.connect()
    configure_duckdb(con, source, int(os.getenv('OPENSEARCH_INDEX_THREADS', '8')))
    if os.getenv('DUCKDB_TEMP_DIRECTORY'):
        escaped = os.getenv('DUCKDB_TEMP_DIRECTORY').replace("'", "''")
        con.execute(f"SET temp_directory='{escaped}'")
    create_canonical_views(con, args.snapshot, source)
    query = canonical_query(con)
    columns = canonical_columns(query)
    indexed = 0
    sample = None

    while True:
        rows = query.fetchmany(batch)
        if not rows:
            break
        lines = []
        for values in rows:
            document = document_from_values(columns, values)
            identifier = str(document.get('id') or '')
            if not identifier:
                raise RuntimeError('Canonical search document is missing id.')
            if sample is None:
                sample = document
            lines.append(json.dumps({'index': {'_index': index, '_id': identifier}}, separators=(',', ':')))
            lines.append(json.dumps(document, separators=(',', ':'), default=str))
        raw = ('\n'.join(lines) + '\n').encode()
        compressed = gzip.compress(raw, compresslevel=1)
        response = None
        for attempt in range(5):
            req_headers = headers('application/x-ndjson')
            req_headers['Content-Encoding'] = 'gzip'
            req = urllib.request.Request(f'{endpoint}/_bulk', data=compressed, method='POST', headers=req_headers)
            try:
                with urllib.request.urlopen(req, timeout=60) as result:
                    response = json.loads(result.read())
                break
            except urllib.error.HTTPError as error:
                body = error.read().decode(errors='replace')[:1000]
                if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 4:
                    raise RuntimeError(f'OpenSearch bulk failed {error.code}: {body}') from error
                time.sleep(min(30, 2 ** attempt))
        failed = [item for item in response.get('items', []) if item.get('index', {}).get('status', 500) >= 300]
        if failed:
            raise RuntimeError(f'OpenSearch bulk batch contained {len(failed)} failures: {json.dumps(failed[:5])[:2000]}')
        indexed += len(rows)
        print(f'indexed={indexed}', flush=True)

    if indexed <= 0 or sample is None:
        raise RuntimeError('Canonical snapshot produced no OpenSearch documents.')
    request('POST', f'/{index}/_refresh')
    count = int(request('GET', f'/{index}/_count').get('count', -1))
    if count != indexed:
        raise RuntimeError(f'OpenSearch count={count}, locally indexed={indexed}.')

    sample_id = urllib.parse.quote(str(sample['id']), safe='')
    if not request('GET', f'/{index}/_doc/{sample_id}').get('found'):
        raise RuntimeError('OpenSearch sample ID lookup failed.')
    if int(request('POST', f'/{index}/_search', {'size': 1, 'query': {'match': {'name': sample['name']}}}).get('hits', {}).get('total', {}).get('value', 0)) < 1:
        raise RuntimeError('OpenSearch sample text query failed.')
    location = sample.get('location') or {}
    if location.get('lat') is not None and location.get('lon') is not None:
        geo = request('POST', f'/{index}/_search', {'size': 1, 'query': {'bool': {'filter': {'geo_distance': {'distance': '1km', 'location': location}}}}})
        if int(geo.get('hits', {}).get('total', {}).get('value', 0)) < 1:
            raise RuntimeError('OpenSearch sample geo query failed.')

    request('PUT', f'/{index}/_settings', {'index': {'refresh_interval': os.getenv('OPENSEARCH_REFRESH_INTERVAL', '30s')}})
    actions = [
        {'remove': {'index': 'locations-v1-*', 'alias': args.alias, 'must_exist': False}},
        {'add': {'index': index, 'alias': args.alias}},
    ]
    request('POST', '/_aliases', {'actions': actions})
    alias = urllib.parse.quote(args.alias, safe='-_.')
    alias_count = int(request('GET', f'/{alias}/_count').get('count', -1))
    if alias_count != indexed:
        raise RuntimeError(f'OpenSearch alias count={alias_count}, indexed={indexed}.')
    print(json.dumps({'ok': True, 'snapshot': args.snapshot, 'index': index, 'alias': args.alias, 'documents': indexed}, indent=2), flush=True)
    con.close()


if __name__ == '__main__':
    main()
