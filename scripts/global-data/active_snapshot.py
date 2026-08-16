#!/usr/bin/env python3
import json
import os
import boto3
from botocore.client import Config

client=boto3.client('s3',endpoint_url=os.environ['B2_DATA_S3_ENDPOINT'],aws_access_key_id=os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID'],aws_secret_access_key=os.environ['B2_DATA_APPLICATION_KEY'],config=Config(retries={'max_attempts':10,'mode':'adaptive'}))
payload=json.loads(client.get_object(Bucket=os.environ['B2_DATA_BUCKET_NAME'],Key='manifests/active-location-snapshot.json')['Body'].read())
print(json.dumps(payload,indent=2))
if os.getenv('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as output:
        output.write(f"snapshot={payload['snapshot']}\n")
        output.write(f"index={payload['index']}\n")
