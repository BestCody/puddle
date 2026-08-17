#!/usr/bin/env python3
"""Validate an already-built OpenSearch location index and atomically activate it.

This recovery path exists specifically so a failure after bulk indexing does not
force Puddle to re-index the entire global catalogue. It deliberately avoids
GET /_alias/<name> before the switch; the atomic _aliases request removes the
alias from any old locations-v1-* index (if present) and adds it to the validated
index in one transaction.
"""
import argparse
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
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
parser.add_argument('--index', required=True)
parser.add_argument('--alias', default='locations-active')
parser.add_argument('--expected-count', type=int, default=0)
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', ''))
args = parser.parse_args()

if not args.index.startswith('locations-v1-'):
    raise RuntimeError(f'Refusing to activate unexpected index name: {args.index}')
if args.alias != 'locations-active':
    raise RuntimeError(f'Refusing to activate unexpected production alias: {args.alias}')

ENDPOINT = first_env('GLOBAL_LOCATION_SEARCH_URL', 'OPENSEARCH_URL').rstrip('/')
if not ENDPOINT:
    raise RuntimeError('GLOBAL_LOCATION_SEARCH_URL or OPENSEARCH_URL is required.')
if not (ENDPOINT.startswith('https://') or ENDPOINT.startswith('http://localhost') or ENDPOINT.startswith('http://127.0.0.1')):
    raise RuntimeError('OpenSearch endpoint must use HTTPS outside local development.')


def headers(content_type='application/json'):
    result = {'Accept': 'application/json', 'Content-Type': content_type}
    user = os.getenv('OPENSEARCH_USERNAME', '').strip()
    password = os.getenv('OPENSEARCH_PASSWORD', '').strip()
    bearer = os.getenv('OPENSEARCH_BEARER_TOKEN', '').strip()
    if bearer:
        result['Authorization'] = f'Bearer {bearer}'
    elif user or password:
        if not user or not password:
            raise RuntimeError('Both OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD are required.')
        result['Authorization'] = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()
    return result


def request(method, path, payload=None, retries=5):
    body = None if payload is None else json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(f'{ENDPOINT}{path}', data=body, method=method, headers=headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read().decode(errors='replace')[:3000]
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt + 1 >= retries:
                raise RuntimeError(f'OpenSearch {method} {path} failed with {error.code}: {raw}') from error
            import time
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError('OpenSearch request exhausted retries.')


encoded_index = urllib.parse.quote(args.index, safe='-_.')
encoded_alias = urllib.parse.quote(args.alias, safe='-_.')

# Revalidate the artifact left by the previous run before touching production.
count = int(request('GET', f'/{encoded_index}/_count').get('count', 0))
if count <= 0:
    raise RuntimeError(f'Candidate index {args.index} is empty.')
if args.expected_count and count != args.expected_count:
    raise RuntimeError(f'Candidate index count mismatch: expected {args.expected_count}, got {count}.')

settings = request('GET', f'/{encoded_index}/_settings')
index_settings = settings.get(args.index, {}).get('settings', {}).get('index', {})
shards = int(index_settings.get('number_of_shards', 0))
replicas = int(index_settings.get('number_of_replicas', -1))
if shards != int(os.getenv('OPENSEARCH_LOCATION_SHARDS', '6')):
    raise RuntimeError(f'Candidate index shard mismatch: {shards}.')
if replicas != int(os.getenv('OPENSEARCH_LOCATION_REPLICAS', '2')):
    raise RuntimeError(f'Candidate index replica mismatch: {replicas}.')

health = request('GET', f'/_cluster/health/{encoded_index}')
if str(health.get('status', '')).lower() == 'red':
    raise RuntimeError(f'Candidate index health is red: {json.dumps(health)[:2000]}')

sample = request('POST', f'/{encoded_index}/_search', {'size': 1, 'query': {'match_all': {}}})
hits = sample.get('hits', {}).get('hits', [])
if not hits:
    raise RuntimeError('Candidate index validation search returned no documents.')

print(json.dumps({
    'candidate': args.index,
    'documents': count,
    'shards': shards,
    'replicas': replicas,
    'health': health.get('status'),
    'validation': 'passed',
}, indent=2), flush=True)

# Atomic blue/green switch without a pre-switch alias lookup. `must_exist: false`
# makes first activation and subsequent replacements use the same transaction.
actions = [
    {'remove': {'index': 'locations-v1-*', 'alias': args.alias, 'must_exist': False}},
    {'add': {'index': args.index, 'alias': args.alias}},
]
request('POST', '/_aliases', {'actions': actions})

# Verify through the serving alias itself rather than GET /_alias/<name>.
alias_count = int(request('GET', f'/{encoded_alias}/_count').get('count', -1))
if alias_count != count:
    raise RuntimeError(f'Alias validation failed: alias count={alias_count}, index count={count}.')
alias_search = request('POST', f'/{encoded_alias}/_search', {'size': 1, 'query': {'match_all': {}}})
if not alias_search.get('hits', {}).get('hits'):
    raise RuntimeError('Alias validation failed: production search returned no documents.')

# Publish the same active B2 pointer as the full indexer.
BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
B2_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
B2_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
B2_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not B2_ENDPOINT_URL or not B2_KEY_ID or not B2_KEY:
    raise RuntimeError('B2 endpoint and credentials are required to publish the active pointer.')

active = {
    'index': args.index,
    'alias': args.alias,
    'documents': count,
    'snapshot': args.snapshot,
    'activatedAt': datetime.now(timezone.utc).isoformat(),
    'validation': {
        'count': True,
        'search': True,
        'shards': shards,
        'replicas': replicas,
        'health': health.get('status'),
    },
}
b2 = boto3.client(
    's3', endpoint_url=B2_ENDPOINT_URL, aws_access_key_id=B2_KEY_ID,
    aws_secret_access_key=B2_KEY, config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)
b2.put_object(
    Bucket=BUCKET,
    Key=f'{DATA_PREFIX}/manifests/active-location-snapshot.json',
    Body=(json.dumps(active, indent=2) + '\n').encode(),
    ContentType='application/json',
)
print(json.dumps(active, indent=2), flush=True)
