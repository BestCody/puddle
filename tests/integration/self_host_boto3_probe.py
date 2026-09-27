"""Explicit loopback-only S3 compatibility probe for the photo/index workers."""

import hashlib
import os
import uuid
from urllib.parse import urlparse

import boto3


def main():
    endpoint = os.environ['PUDDLE_TEST_S3_ENDPOINT']
    if urlparse(endpoint).hostname != '127.0.0.1':
        raise RuntimeError('The worker S3 probe only runs against loopback.')
    bucket = os.environ.get('PUDDLE_TEST_S3_BUCKET', 'puddle-assets')
    client = boto3.client(
        's3',
        endpoint_url=endpoint,
        region_name='us-east-1',
        aws_access_key_id=os.environ['PUDDLE_TEST_S3_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['PUDDLE_TEST_S3_SECRET_ACCESS_KEY'],
    )
    key = f'data/search/probe-{uuid.uuid4()}.json'
    body = b'{"selfHost":true}'
    digest = hashlib.sha256(body).hexdigest()
    try:
        client.put_object(Bucket=bucket, Key=key, Body=body, Metadata={'sha256': digest})
        obj = client.get_object(Bucket=bucket, Key=key)
        assert obj['Body'].read() == body
        assert obj['Metadata']['sha256'] == digest
        assert client.head_object(Bucket=bucket, Key=key)['ContentLength'] == len(body)
        assert any(item['Key'] == key for item in client.list_objects_v2(Bucket=bucket, Prefix=key)['Contents'])
        print('SeaweedFS boto3 put/get/head/list/metadata passed')
    finally:
        client.delete_object(Bucket=bucket, Key=key)


if __name__ == '__main__':
    main()
