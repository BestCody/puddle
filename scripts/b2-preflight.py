#!/usr/bin/env python3
"""Non-destructive Backblaze B2 preflight for Puddle's canonical data bucket.

The script deliberately never prints credentials and never deletes existing objects.
It validates authorization, bucket visibility, list/read/write access, records a small
canary object under data/preflight/, and reports bounded storage statistics.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
from botocore.client import Config


def first_env(*names, default=''):
    for name in names:
        value = str(os.getenv(name, '')).strip()
        if value:
            return value
    return default


def required(value, label):
    value = str(value or '').strip()
    if not value:
        raise RuntimeError(f'{label} is required.')
    return value


def authorize_b2(key_id, application_key):
    token = base64.b64encode(f'{key_id}:{application_key}'.encode()).decode()
    request = urllib.request.Request(
        'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
        headers={'Authorization': f'Basic {token}', 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    storage = payload.get('apiInfo', {}).get('storageApi', {})
    return {
        'accountId': payload.get('accountId'),
        'downloadUrl': storage.get('downloadUrl'),
        's3ApiUrl': storage.get('s3ApiUrl'),
        'allowed': storage.get('allowed') or {},
    }


def safe_endpoint(endpoint):
    parsed = urlparse(endpoint)
    return f'{parsed.scheme}://{parsed.hostname}' if parsed.hostname else '<configured>'


parser = argparse.ArgumentParser()
parser.add_argument('--prefix', default=first_env('B2_DATA_PREFIX', default='data') + '/preflight')
parser.add_argument('--max-list-pages', type=int, default=100)
args = parser.parse_args()

key_id = required(first_env('B2_DATA_APPLICATION_KEY_ID', 'B2_DATA_KEY_ID', 'B2_KEY_ID'), 'B2 application key ID')
application_key = required(first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY'), 'B2 application key')
bucket = required(first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets'), 'B2 bucket name')
endpoint = required(first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT'), 'B2 S3 endpoint')
region = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')

if not endpoint.startswith('https://'):
    raise RuntimeError('B2 S3 endpoint must use HTTPS.')

auth = authorize_b2(key_id, application_key)
allowed = auth.get('allowed') or {}
capabilities = sorted(set(allowed.get('capabilities') or []))
allowed_buckets = allowed.get('buckets') or []
if allowed_buckets and bucket not in {row.get('name') for row in allowed_buckets}:
    raise RuntimeError(f'Configured bucket {bucket!r} is not exposed by this restricted key.')

s3 = boto3.client(
    's3',
    endpoint_url=endpoint,
    region_name=region,
    aws_access_key_id=key_id,
    aws_secret_access_key=application_key,
    config=Config(signature_version='s3v4', retries={'max_attempts': 10, 'mode': 'adaptive'}),
)

# Visibility and list/read checks.
s3.head_bucket(Bucket=bucket)
object_count = 0
total_bytes = 0
pages = 0
continuation = None
while pages < max(1, args.max_list_pages):
    kwargs = {'Bucket': bucket, 'MaxKeys': 1000}
    if continuation:
        kwargs['ContinuationToken'] = continuation
    response = s3.list_objects_v2(**kwargs)
    pages += 1
    rows = response.get('Contents') or []
    object_count += len(rows)
    total_bytes += sum(int(row.get('Size') or 0) for row in rows)
    if not response.get('IsTruncated'):
        continuation = None
        break
    continuation = response.get('NextContinuationToken')
    if not continuation:
        break
list_complete = continuation is None

# Write and immediately read a tiny namespaced canary. We intentionally do not
# delete it because restricted writer keys may not have deleteFiles capability.
stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
run_id = first_env('GITHUB_RUN_ID', default='local')
canary_key = '/'.join(part.strip('/') for part in [args.prefix, 'canary', f'{stamp}-{run_id}.json'] if part.strip('/'))
canary = {
    'kind': 'puddle-b2-preflight',
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'runId': run_id,
    'host': socket.gethostname(),
}
body = (json.dumps(canary, sort_keys=True) + '\n').encode()
expected_sha256 = hashlib.sha256(body).hexdigest()
s3.put_object(Bucket=bucket, Key=canary_key, Body=body, ContentType='application/json', Metadata={'sha256': expected_sha256})
head = s3.head_object(Bucket=bucket, Key=canary_key)
read_body = s3.get_object(Bucket=bucket, Key=canary_key)['Body'].read()
actual_sha256 = hashlib.sha256(read_body).hexdigest()
if read_body != body or actual_sha256 != expected_sha256:
    raise RuntimeError('B2 canary read-back did not match the bytes that were written.')

result = {
    'ok': True,
    'bucket': bucket,
    'region': region,
    'endpoint': safe_endpoint(endpoint),
    'authorizedBucketCount': len(allowed_buckets),
    'capabilities': capabilities,
    'listComplete': list_complete,
    'listedPages': pages,
    'objectCount': object_count,
    'totalBytes': total_bytes,
    'canaryKey': canary_key,
    'canaryBytes': int(head.get('ContentLength') or len(body)),
    'canarySha256Verified': True,
}
print(json.dumps(result, indent=2))

summary = os.getenv('GITHUB_STEP_SUMMARY')
if summary:
    with open(summary, 'a', encoding='utf-8') as out:
        out.write('## B2 preflight\n\n')
        out.write(f"- Bucket: `{bucket}`\n")
        out.write(f"- Region: `{region}`\n")
        out.write(f"- Endpoint: `{safe_endpoint(endpoint)}`\n")
        suffix = '' if list_complete else ' (lower bound; page cap reached)'
        out.write(f"- Objects: `{object_count:,}`{suffix}\n")
        out.write(f"- Bytes: `{total_bytes:,}`{suffix}\n")
        out.write(f"- Canary: `{canary_key}`\n")
        out.write('- Canary read-back/hash: `verified`\n')
        out.write(f"- Reported capabilities: `{', '.join(capabilities) if capabilities else 'not enumerated'}`\n")
