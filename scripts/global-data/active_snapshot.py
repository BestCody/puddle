#!/usr/bin/env python3
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


endpoint = first_env('OBJECT_STORAGE_ENDPOINT')
key_id = first_env('OBJECT_STORAGE_ACCESS_KEY_ID')
key = first_env('OBJECT_STORAGE_SECRET_ACCESS_KEY')
bucket = first_env('OBJECT_STORAGE_BUCKET', default='puddle-assets')
data_prefix = clean_prefix(first_env('PUDDLE_DATA_PREFIX', default='data'))
if not endpoint or not key_id or not key:
    raise RuntimeError('Object storage endpoint and credentials are required.')

client = boto3.client(
    's3', endpoint_url=endpoint, aws_access_key_id=key_id, aws_secret_access_key=key,
    config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
)
manifest_key = f'{data_prefix}/manifests/active-location-snapshot.json'
payload = json.loads(client.get_object(Bucket=bucket, Key=manifest_key)['Body'].read())
print(json.dumps(payload, indent=2))
