#!/usr/bin/env python3
"""Remove stale partial reconciliation outputs only when a snapshot is incomplete."""
import json
import os

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


DATA_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
DATA_ENDPOINT_URL = first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT').rstrip('/')
DATA_KEY_ID = first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID')
DATA_KEY = first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY')
DATA_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
SNAPSHOT = str(os.getenv('GLOBAL_LOCATION_SNAPSHOT', '')).strip()

if not DATA_ENDPOINT_URL or not DATA_KEY_ID or not DATA_KEY or not SNAPSHOT:
    raise RuntimeError('B2 data credentials and active snapshot are required.')

s3 = boto3.client(
    's3', endpoint_url=DATA_ENDPOINT_URL, aws_access_key_id=DATA_KEY_ID,
    aws_secret_access_key=DATA_KEY, region_name=DATA_REGION,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)
state_key = f'{DATA_PREFIX}/enrichment/photo_registry_state/snapshot={SNAPSHOT}/existing-global-reconciled-v1.json'
try:
    payload = json.loads(s3.get_object(Bucket=DATA_BUCKET, Key=state_key)['Body'].read())
    if payload.get('version') == 1 and payload.get('complete') is True:
        print(json.dumps({'snapshot': SNAPSHOT, 'complete': True, 'deletedPartialOutputs': 0}, indent=2))
        raise SystemExit(0)
except SystemExit:
    raise
except Exception:
    pass

prefix = f'{DATA_PREFIX}/enrichment/photo_exclusions/snapshot={SNAPSHOT}/existing-global-'
deleted = 0
continuation = None
while True:
    kwargs = {'Bucket': DATA_BUCKET, 'Prefix': prefix, 'MaxKeys': 1000}
    if continuation:
        kwargs['ContinuationToken'] = continuation
    page = s3.list_objects_v2(**kwargs)
    objects = [{'Key': row['Key']} for row in page.get('Contents', [])]
    if objects:
        response = s3.delete_objects(Bucket=DATA_BUCKET, Delete={'Objects': objects, 'Quiet': True})
        errors = response.get('Errors', [])
        if errors:
            raise RuntimeError(f'failed to delete partial reconciliation outputs: {errors[:5]}')
        deleted += len(objects)
    if not page.get('IsTruncated'):
        break
    continuation = page.get('NextContinuationToken')

print(json.dumps({'snapshot': SNAPSHOT, 'complete': False, 'deletedPartialOutputs': deleted}, indent=2))
