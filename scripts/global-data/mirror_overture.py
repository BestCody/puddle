#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone

import boto3
from botocore import UNSIGNED
from botocore.client import Config
from botocore.exceptions import ClientError
from boto3.s3.transfer import TransferConfig

STAC_URL = 'https://stac.overturemaps.org/catalog.json'
SOURCE_BUCKET = 'overturemaps-us-west-2'


def first_env(*names, default=''):
    for name in names:
        value = str(os.getenv(name, '')).strip()
        if value:
            return value
    return default


def clean_prefix(value):
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


parser = argparse.ArgumentParser(description='Mirror the current Overture Places GeoParquet release into the canonical B2 raw lake.')
parser.add_argument('--release', default=os.getenv('OVERTURE_RELEASE', 'latest'))
parser.add_argument('--workers', type=int, default=int(os.getenv('OVERTURE_MIRROR_WORKERS', '8')))
parser.add_argument('--max-files', type=int, default=int(os.getenv('OVERTURE_MIRROR_MAX_FILES', '0')))
args = parser.parse_args()

B2_ENDPOINT = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT')
B2_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
B2_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
B2_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
if not B2_ENDPOINT or not B2_KEY_ID or not B2_KEY:
    raise RuntimeError('B2 endpoint and credentials are required to mirror Overture.')


def latest_release():
    with urllib.request.urlopen(STAC_URL, timeout=20) as response:
        payload = json.load(response)
    value = payload.get('latest')
    if not value:
        raise RuntimeError('Overture STAC catalog did not expose latest release.')
    return str(value).rstrip('/').split('/')[-1]


release = latest_release() if args.release == 'latest' else args.release.strip().rstrip('/')
if not release:
    raise RuntimeError('Overture release is empty.')

source = boto3.client('s3', region_name='us-west-2', config=Config(signature_version=UNSIGNED, retries={'max_attempts': 10, 'mode': 'adaptive'}))
destination = boto3.client(
    's3', endpoint_url=B2_ENDPOINT, aws_access_key_id=B2_KEY_ID, aws_secret_access_key=B2_KEY,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=max(16, args.workers * 2)),
)
prefix = f'release/{release}/theme=places/type=place/'
objects = []
paginator = source.get_paginator('list_objects_v2')
for page in paginator.paginate(Bucket=SOURCE_BUCKET, Prefix=prefix):
    for row in page.get('Contents', []):
        key = row['Key']
        if key.endswith('.parquet'):
            objects.append({'key': key, 'size': int(row['Size']), 'etag': str(row.get('ETag', '')).strip('"')})
if args.max_files > 0:
    objects = objects[: args.max_files]
if not objects:
    raise RuntimeError(f'No Overture place Parquet files found under {prefix}.')

transfer = TransferConfig(multipart_threshold=64 * 1024 * 1024, multipart_chunksize=64 * 1024 * 1024, max_concurrency=8, use_threads=True)


def mirror(row):
    relative = row['key'][len(prefix):]
    target_key = f'{DATA_PREFIX}/raw/overture/release={release}/theme=places/type=place/{relative}'
    try:
        head = destination.head_object(Bucket=B2_BUCKET, Key=target_key)
        if head.get('Metadata', {}).get('source-etag') == row['etag'] and int(head.get('ContentLength', -1)) == row['size']:
            return {'key': target_key, 'bytes': row['size'], 'status': 'unchanged'}
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') not in {'404', 'NoSuchKey', 'NotFound'}:
            status = error.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
            if status != 404:
                raise

    with tempfile.NamedTemporaryFile(prefix='overture-', suffix='.parquet', delete=True) as tmp:
        source.download_fileobj(SOURCE_BUCKET, row['key'], tmp, Config=transfer)
        tmp.flush()
        tmp.seek(0)
        destination.upload_fileobj(
            tmp, B2_BUCKET, target_key,
            ExtraArgs={'ContentType': 'application/vnd.apache.parquet', 'Metadata': {'source-etag': row['etag'], 'source': 'overture'}},
            Config=transfer,
        )
    return {'key': target_key, 'bytes': row['size'], 'status': 'uploaded'}


results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(32, args.workers))) as executor:
    for result in executor.map(mirror, objects):
        results.append(result)
        print(f"{result['status']}: {result['key']} ({result['bytes']} bytes)")

manifest = {
    'source': 'overture', 'release': release, 'mirroredAt': datetime.now(timezone.utc).isoformat(),
    'objectCount': len(results), 'totalBytes': sum(r['bytes'] for r in results),
    'uploaded': sum(r['status'] == 'uploaded' for r in results), 'unchanged': sum(r['status'] == 'unchanged' for r in results),
}
manifest_key = f'{DATA_PREFIX}/raw/overture/release={release}/manifest.json'
destination.put_object(Bucket=B2_BUCKET, Key=manifest_key, Body=(json.dumps(manifest, indent=2) + '\n').encode(), ContentType='application/json')
print(json.dumps(manifest, indent=2))
if os.getenv('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('overture_release=' + str(release) + '\n')
