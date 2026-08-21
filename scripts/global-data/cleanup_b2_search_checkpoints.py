#!/usr/bin/env python3
"""Delete all retained B2 search checkpoint versions for a snapshot after full gate success."""
from __future__ import annotations

import argparse

import boto3
from botocore.client import Config

from location_search_common import b2_source_config


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True)
    args = parser.parse_args()

    source = b2_source_config()
    prefix = f'{source.data_prefix}/search/checkpoints/schema=v1/snapshot={args.snapshot}/'
    s3 = boto3.client(
        's3',
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}),
    )

    versions: list[dict] = []
    paginator = s3.get_paginator('list_object_versions')
    for page in paginator.paginate(Bucket=source.bucket, Prefix=prefix):
        for item in page.get('Versions', []):
            key = str(item.get('Key') or '')
            version_id = str(item.get('VersionId') or '')
            if key and version_id:
                versions.append({'Key': key, 'VersionId': version_id})
        for item in page.get('DeleteMarkers', []):
            key = str(item.get('Key') or '')
            version_id = str(item.get('VersionId') or '')
            if key and version_id:
                versions.append({'Key': key, 'VersionId': version_id})

    deleted = 0
    for start in range(0, len(versions), 1000):
        batch = versions[start:start + 1000]
        response = s3.delete_objects(Bucket=source.bucket, Delete={'Objects': batch, 'Quiet': True})
        errors = response.get('Errors') or []
        if errors:
            raise RuntimeError(f'Checkpoint cleanup failed for {len(errors)} object versions: {errors[:3]}')
        deleted += len(batch)
        print(f'checkpoint_cleanup_versions={deleted}/{len(versions)}', flush=True)

    print(f'checkpoint_cleanup_complete prefix={prefix} deleted_versions={deleted}', flush=True)


if __name__ == '__main__':
    main()
