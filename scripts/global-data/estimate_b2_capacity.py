"""Read-only size inventory for planning a complete B2 object migration.

Lists object metadata only. Does not download or change any object. Listing a
large bucket can take time and incur provider request charges.
"""

import argparse
import json
import os
import sys


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} must be configured.')
    return value


def group_for_key(key):
    if key.startswith('data/'):
        return 'data'
    if key.startswith('media/'):
        return 'media'
    return 'other'


def inventory(client, bucket, prefix):
    groups = {name: {'objects': 0, 'bytes': 0} for name in ('data', 'media', 'other')}
    pages = 0
    paginator = client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        pages += 1
        for item in page.get('Contents', []):
            name = group_for_key(str(item['Key']))
            groups[name]['objects'] += 1
            groups[name]['bytes'] += int(item['Size'])
        if pages % 1000 == 0:
            print(f'Listed {pages} pages...', file=sys.stderr)
    return {
        'bucket': bucket,
        'prefix': prefix,
        'pages': pages,
        'groups': groups,
        'totalObjects': sum(group['objects'] for group in groups.values()),
        'totalBytes': sum(group['bytes'] for group in groups.values()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', default='', help='Optional scope; omit to inventory the entire bucket.')
    args = parser.parse_args()
    import boto3

    bucket = required('B2_BUCKET')
    client = boto3.client(
        's3',
        endpoint_url=required('B2_S3_ENDPOINT'),
        region_name=required('B2_REGION'),
        aws_access_key_id=required('B2_KEY_ID'),
        aws_secret_access_key=required('B2_APPLICATION_KEY'),
    )
    print(json.dumps(inventory(client, bucket, args.prefix), indent=2))


if __name__ == '__main__':
    main()
