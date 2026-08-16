#!/usr/bin/env python3
"""Materialize the best licensed photo candidates into B2 media.

Candidate discovery is bulk/spatial. This worker only fetches bytes for selected
candidates, normalizes them, writes immutable content-addressed media, and emits
photo metadata back into the B2 enrichment lake for OpenSearch rebuilds.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
parser.add_argument('--countries', default=os.getenv('GLOBAL_PHOTO_COUNTRIES', ''))
parser.add_argument('--limit', type=int, default=int(os.getenv('GLOBAL_PHOTO_MATERIALIZE_LIMIT', '10000')))
args = parser.parse_args()

DATA_BUCKET = os.environ['B2_DATA_BUCKET_NAME']
DATA_ENDPOINT_URL = os.environ['B2_DATA_S3_ENDPOINT'].rstrip('/')
DATA_ENDPOINT = DATA_ENDPOINT_URL.replace('https://','').replace('http://','')
DATA_KEY_ID = os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID']
DATA_KEY = os.environ['B2_DATA_APPLICATION_KEY']
DATA_REGION = os.getenv('B2_DATA_S3_REGION','us-west-004')
MEDIA_BUCKET = os.environ['B2_MEDIA_BUCKET_NAME']
MEDIA_ENDPOINT = os.environ.get('B2_MEDIA_S3_ENDPOINT', DATA_ENDPOINT_URL)
MEDIA_KEY_ID = os.getenv('B2_MEDIA_KEY_ID') or os.environ['B2_MEDIA_APPLICATION_KEY_ID']
MEDIA_KEY = os.environ['B2_MEDIA_APPLICATION_KEY']
MEDIA_BASE = os.environ['B2_MEDIA_PUBLIC_BASE_URL'].rstrip('/')
MEDIA_PREFIX = os.getenv('B2_MEDIA_OPEN_PHOTO_PREFIX','photos/by-sha256').strip('/')
MAPILLARY_TOKEN = os.getenv('MAPILLARY_ACCESS_TOKEN','').strip()
CONCURRENCY = max(1,min(256,int(os.getenv('GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY','96'))))
LIMIT = max(1,min(1_000_000,args.limit))
MAX_BYTES = 10_000_000

if not MEDIA_BASE.startswith('https://'):
    raise RuntimeError('B2_MEDIA_PUBLIC_BASE_URL must be HTTPS.')

s3 = boto3.client('s3',endpoint_url=MEDIA_ENDPOINT,aws_access_key_id=MEDIA_KEY_ID,aws_secret_access_key=MEDIA_KEY,config=Config(retries={'max_attempts':10,'mode':'adaptive'},max_pool_connections=max(128,CONCURRENCY*2)))
data_s3 = boto3.client('s3',endpoint_url=DATA_ENDPOINT_URL,aws_access_key_id=DATA_KEY_ID,aws_secret_access_key=DATA_KEY,config=Config(retries={'max_attempts':10,'mode':'adaptive'}))

def prefix_exists(prefix):
    return bool(data_s3.list_objects_v2(Bucket=DATA_BUCKET,Prefix=prefix.rstrip('/')+'/',MaxKeys=1).get('KeyCount'))

def public_url(key):
    return MEDIA_BASE + '/' + '/'.join(urllib.parse.quote(part,safe='') for part in key.split('/'))

def mapillary_details(image_id):
    if not MAPILLARY_TOKEN: raise RuntimeError('MAPILLARY_ACCESS_TOKEN is required to materialize Mapillary candidates.')
    fields='id,thumb_2048_url,width,height,creator,quality_score'
    url=f'https://graph.mapillary.com/{urllib.parse.quote(str(image_id))}?'+urllib.parse.urlencode({'fields':fields,'access_token':MAPILLARY_TOKEN})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'Puddle/1.0 global photo materializer'}),timeout=20) as response:
                row=json.load(response)
            creator=str((row.get('creator') or {}).get('username') or (row.get('creator') or {}).get('name') or 'Mapillary contributor').strip()
            return {
                'asset_url':row.get('thumb_2048_url'),
                'page_url':f'https://www.mapillary.com/app/?pKey={urllib.parse.quote(str(image_id))}&focus=photo',
                'attribution':f'{creator} · Mapillary · CC BY-SA 4.0',
                'license':'CC-BY-SA-4.0','license_url':'https://creativecommons.org/licenses/by-sa/4.0/'
            }
        except urllib.error.HTTPError as error:
            if error.code not in {408,425,429,500,502,503,504} or attempt==5: raise
            retry=error.headers.get('Retry-After')
            time.sleep(float(retry) if retry and retry.isdigit() else min(30,0.5*(2**attempt)))
        except Exception:
            if attempt==5: raise
            time.sleep(min(10,0.5*(2**attempt)))
    raise RuntimeError('Mapillary image lookup failed.')

def approved_host(provider, hostname):
    host=hostname.lower()
    if provider=='wikimedia-commons': return host=='upload.wikimedia.org'
    if provider=='mapillary': return host.endswith('.fbcdn.net') or host=='fbcdn.net' or host.endswith('.mapillary.com') or host=='mapillary.com'
    if provider=='kartaview': return host.endswith('.openstreetcam.org') or host=='openstreetcam.org' or host.endswith('.kartaview.org') or host=='kartaview.org'
    return False

def download(url,provider):
    current=str(url or '')
    for redirects in range(3):
        parsed=urllib.parse.urlparse(current)
        if parsed.scheme!='https' or not approved_host(provider,parsed.hostname or ''): raise RuntimeError(f'unapproved {provider} asset host')
        req=urllib.request.Request(current,headers={'Accept':'image/avif,image/webp,image/png,image/jpeg','User-Agent':'Puddle/1.0 licensed photo materializer'})
        try:
            with urllib.request.urlopen(req,timeout=30) as response:
                content_type=(response.headers.get_content_type() or '').lower()
                declared=int(response.headers.get('Content-Length') or 0)
                if declared>MAX_BYTES: raise RuntimeError('image exceeds 10 MB')
                body=response.read(MAX_BYTES+1)
                if not body or len(body)>MAX_BYTES: raise RuntimeError('image is empty or exceeds 10 MB')
                if content_type not in {'image/jpeg','image/png','image/webp','image/avif','application/octet-stream'}: raise RuntimeError(f'unsupported image type {content_type}')
                return body
        except urllib.error.HTTPError as error:
            if error.code in {301,302,303,307,308} and error.headers.get('Location'):
                current=urllib.parse.urljoin(current,error.headers['Location']); continue
            raise
    raise RuntimeError('too many image redirects')

def dhash(image):
    gray=image.convert('L').resize((9,8))
    pixels=list(gray.getdata()); bits=0
    for row in range(8):
        for col in range(8):
            bits=(bits<<1)|(1 if pixels[row*9+col]>pixels[row*9+col+1] else 0)
    return f'{bits:016x}'

def normalize(body):
    with Image.open(io.BytesIO(body)) as original:
        image=ImageOps.exif_transpose(original).convert('RGB')
        if image.width>1600 or image.height>1000:
            image.thumbnail((1600,1000),Image.Resampling.LANCZOS)
        out=io.BytesIO(); image.save(out,format='JPEG',quality=84,optimize=True,progressive=True)
        data=out.getvalue()
        return data,image.width,image.height,dhash(image)

def upload_media(data):
    sha256=hashlib.sha256(data).hexdigest(); key=f'{MEDIA_PREFIX}/{sha256[:2]}/{sha256}.jpg'
    try:
        head=s3.head_object(Bucket=MEDIA_BUCKET,Key=key)
        if int(head.get('ContentLength',-1))==len(data) and head.get('Metadata',{}).get('sha256')==sha256:
            return key,sha256
    except Exception: pass
    s3.put_object(Bucket=MEDIA_BUCKET,Key=key,Body=data,ContentType='image/jpeg',CacheControl='public, max-age=31536000, immutable',Metadata={'sha256':sha256,'purpose':'puddle_open_location_photo'})
    head=s3.head_object(Bucket=MEDIA_BUCKET,Key=key)
    if int(head.get('ContentLength',-1))!=len(data): raise RuntimeError('B2 media size verification failed')
    return key,sha256

def materialize(row):
    provider=row['provider']; candidate=dict(row)
    if provider=='mapillary': candidate.update(mapillary_details(row['external_photo_id']))
    body=download(candidate.get('asset_url'),provider)
    normalized,width,height,perceptual=normalize(body)
    key,content_hash=upload_media(normalized)
    return {
        'location_id':row['location_id'],'provider':provider,'external_photo_id':row['external_photo_id'],
        'url':public_url(key),'storage_backend':'b2','storage_key':key,'content_hash':content_hash,'perceptual_hash':perceptual,
        'byte_size':len(normalized),'width':width,'height':height,'attribution':candidate.get('attribution'),
        'attribution_url':candidate.get('page_url'),'license':candidate.get('license'),'license_url':candidate.get('license_url'),
        'rank_score':float(row.get('rank_score') or 0),'verified_at':datetime.now(timezone.utc).isoformat()
    }

con=duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET preserve_insertion_order=false')
con.execute(f"""CREATE OR REPLACE SECRET b2_data_secret (TYPE S3,KEY_ID '{DATA_KEY_ID.replace("'","''")}',SECRET '{DATA_KEY.replace("'","''")}',REGION '{DATA_REGION.replace("'","''")}',ENDPOINT '{DATA_ENDPOINT.replace("'","''")}',URL_STYLE 'path',USE_SSL true);""")

def countries():
    if args.countries.strip(): return sorted({v.strip().upper() for v in args.countries.split(',') if v.strip()})
    return [str(r[0]) for r in con.execute(f"SELECT DISTINCT country_code FROM read_parquet('s3://{DATA_BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code=*/locations.parquet',hive_partitioning=true) ORDER BY country_code").fetchall() if r[0]]

remaining=LIMIT
for country in countries():
    if remaining<=0: break
    map_prefix=f'enrichment/photo_candidates/provider=mapillary/snapshot={args.snapshot}/country_code={country}'
    wiki_prefix=f'enrichment/photo_candidates/provider=wikimedia-commons/snapshot={args.snapshot}/country_code={country}'
    karta_prefix=f'enrichment/photo_candidates/provider=kartaview/snapshot={args.snapshot}/country_code={country}'
    sources=[]
    if prefix_exists(map_prefix): sources.append(f"SELECT location_id,provider,external_photo_id,NULL::VARCHAR asset_url,NULL::VARCHAR page_url,NULL::VARCHAR attribution,NULL::VARCHAR license,NULL::VARCHAR license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{map_prefix}/candidates.parquet')")
    if prefix_exists(wiki_prefix): sources.append(f"SELECT location_id,provider,external_photo_id,asset_url,page_url,attribution,license,license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{wiki_prefix}/candidates.parquet')")
    if prefix_exists(karta_prefix): sources.append(f"SELECT location_id,provider,external_photo_id,asset_url,page_url,attribution,license,license_url,rank_score FROM read_parquet('s3://{DATA_BUCKET}/{karta_prefix}/candidates.parquet')")
    if not sources: continue
    union=' UNION ALL '.join(sources)
    loc=f"s3://{DATA_BUCKET}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet"
    con.execute(f"CREATE OR REPLACE TEMP VIEW all_candidates AS {union}")
    existing_sources=[]
    bootstrap_photo=f'normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/photo_metadata.parquet'
    if prefix_exists(bootstrap_photo.rsplit('/',1)[0]):
        existing_sources.append(f"SELECT location_id FROM read_parquet('s3://{DATA_BUCKET}/{bootstrap_photo}')")
    enriched_prefix=f'enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}'
    if prefix_exists(enriched_prefix):
        existing_sources.append(f"SELECT location_id FROM read_parquet('s3://{DATA_BUCKET}/{enriched_prefix}/*.parquet', union_by_name=true)")
    if existing_sources:
        con.execute(f"CREATE OR REPLACE TEMP VIEW existing_photos AS {' UNION ALL '.join(existing_sources)}")
    else:
        con.execute("CREATE OR REPLACE TEMP VIEW existing_photos AS SELECT NULL::VARCHAR AS location_id WHERE false")
    rows=con.execute(f"""
      WITH l AS (SELECT id,category FROM read_parquet('{loc}')),
      ranked AS (
        SELECT c.*,l.category,
          CASE WHEN l.category IN ('park','museum','gallery','attraction','scenic_spot')
               THEN CASE c.provider WHEN 'wikimedia-commons' THEN 0 WHEN 'mapillary' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END
               ELSE CASE c.provider WHEN 'mapillary' THEN 0 WHEN 'wikimedia-commons' THEN 1 WHEN 'kartaview' THEN 2 ELSE 3 END END provider_rank,
          row_number() OVER(PARTITION BY c.location_id ORDER BY provider_rank,coalesce(c.rank_score,0) DESC,c.external_photo_id) rn
        FROM all_candidates c JOIN l ON l.id=c.location_id
        WHERE NOT EXISTS (SELECT 1 FROM existing_photos e WHERE e.location_id=c.location_id)
      ) SELECT location_id,provider,external_photo_id,asset_url,page_url,attribution,license,license_url,rank_score FROM ranked WHERE rn=1 LIMIT {remaining}
    """).fetchall()
    cols=['location_id','provider','external_photo_id','asset_url','page_url','attribution','license','license_url','rank_score']
    items=[dict(zip(cols,row)) for row in rows]
    results=[]; failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        future_map={pool.submit(materialize,row):row for row in items}
        for future in concurrent.futures.as_completed(future_map):
            row=future_map[future]
            try:
                result=future.result(); results.append(result)
                if len(results)%100==0: print(f'{country}: materialized {len(results)} photos')
            except Exception as error:
                failures.append({'location_id':row['location_id'],'provider':row['provider'],'error':str(error)[:300]})
    if results:
        con.execute('DROP TABLE IF EXISTS materialized_results')
        con.execute('CREATE TEMP TABLE materialized_results(location_id VARCHAR,provider VARCHAR,external_photo_id VARCHAR,url VARCHAR,storage_backend VARCHAR,storage_key VARCHAR,content_hash VARCHAR,perceptual_hash VARCHAR,byte_size BIGINT,width INTEGER,height INTEGER,attribution VARCHAR,attribution_url VARCHAR,license VARCHAR,license_url VARCHAR,rank_score DOUBLE,verified_at VARCHAR)')
        con.executemany('INSERT INTO materialized_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[tuple(r[k] for k in ['location_id','provider','external_photo_id','url','storage_backend','storage_key','content_hash','perceptual_hash','byte_size','width','height','attribution','attribution_url','license','license_url','rank_score','verified_at']) for r in results])
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        out=f's3://{DATA_BUCKET}/enrichment/photo_metadata/snapshot={args.snapshot}/country_code={country}/part-{stamp}.parquet'
        con.execute(f"COPY materialized_results TO '{out}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000)")
    print(json.dumps({'country':country,'selected':len(items),'materialized':len(results),'failed':len(failures),'failureSamples':failures[:10]},indent=2))
    remaining-=len(items)
