#!/usr/bin/env python3
"""Build a resumable keyed serving derivative from the copied, verified ID/slug objects.

Never imports new locations or downloads photos. Source objects remain canonical.
The app can open only a completed immutable file; partial work stays unpublished.
"""
import argparse
import hashlib
import os
import sqlite3
from contextlib import closing
from pathlib import Path

import boto3
import brotli
import orjson
import zstandard as zstd
from botocore.config import Config

from build_object_text_search_projection import detail_document
from indexed_location_data import catalogue_identity, metadata
from location_search_common import object_source_config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--manifest-key', help='Validated candidate to prepare before activation; defaults to the active catalogue.')
    args = parser.parse_args()
    root = Path(args.output_dir)
    if not root.is_absolute() or not root.is_dir():
        raise RuntimeError('Output must be an existing absolute directory.')
    source = object_source_config()
    s3 = boto3.client('s3', endpoint_url=source.endpoint_url, region_name=source.region,
                     aws_access_key_id=source.key_id, aws_secret_access_key=source.application_key,
                     config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=2))

    def get(key):
        return s3.get_object(Bucket=source.bucket, Key=key)['Body'].read()

    active_key = f'{source.data_prefix}/search/active.json'
    original_active_key = orjson.loads(get(active_key))['manifest_key']
    manifest_key = args.manifest_key or original_active_key
    manifest = orjson.loads(get(manifest_key))
    validation = manifest['validation']
    ledger_body = get(validation['hashes_key'])
    if hashlib.sha256(ledger_body).hexdigest() != validation['hashes_sha256']:
        raise RuntimeError('Catalogue ledger checksum mismatch.')
    ledger = orjson.loads(brotli.decompress(ledger_body))
    records = sorted((row for row in ledger if row.get('kind') in {'id', 'slug'}), key=lambda row: (row['kind'], row['key']))
    expected = int(manifest['location_count'])
    if any(sum(int(row['count']) for row in records if row['kind'] == kind) != expected for kind in ('id', 'slug')):
        raise RuntimeError('Keyed catalogue source counts do not match its manifest.')
    identity = catalogue_identity(manifest_key, validation['hashes_sha256'])
    target = root / f'catalogue-{identity}.sqlite'
    if target.exists():
        with closing(sqlite3.connect(f'file:{target}?mode=ro', uri=True)) as existing:
            values = dict(existing.execute('select key,value from metadata'))
        expected_metadata = {'schema_version': '1', 'kind': 'catalogue', 'complete': '1',
                             'source_manifest_key': manifest_key, 'source_ledger_sha256': validation['hashes_sha256'],
                             'location_count': str(expected)}
        if any(values.get(key) != value for key, value in expected_metadata.items()):
            raise RuntimeError('Existing catalogue index differs from its validated source.')
        print(f'catalogue_index_ready=true reused=true locations={expected}', flush=True)
        return
    staged = root / f'.catalogue-{identity}.building.sqlite'
    db = sqlite3.connect(staged)
    db.execute('pragma journal_mode=wal')
    db.execute('pragma cache_size=-32768')
    if not db.execute("select 1 from sqlite_master where name='metadata'").fetchone():
        schema = Path(__file__).resolve().parents[2] / 'config/location-lookup-schema.sql'
        db.executescript(schema.read_text())
        with db:
            metadata(db, {'schema_version': 1, 'kind': 'catalogue', 'complete': 0,
                          'source_manifest_key': manifest_key, 'source_ledger_sha256': validation['hashes_sha256'],
                          'location_count': expected})
    values = dict(db.execute('select key,value from metadata'))
    if values.get('source_manifest_key') != manifest_key or values.get('source_ledger_sha256') != validation['hashes_sha256']:
        raise RuntimeError('Partial catalogue belongs to another source.')
    completed = dict(db.execute('select object_key,sha256 from completed_objects'))
    compressor = zstd.ZstdCompressor(level=1)
    for ordinal, record in enumerate(records):
        key = record['key']
        if key in completed:
            if completed[key] != record['sha256']:
                raise RuntimeError('Completed source checksum changed.')
            continue
        body = get(key)
        if hashlib.sha256(body).hexdigest() != record['sha256']:
            raise RuntimeError(f'Catalogue source checksum mismatch: {key}')
        rows = orjson.loads(brotli.decompress(body))
        if not isinstance(rows, dict) or len(rows) != int(record['count']):
            raise RuntimeError(f'Catalogue source count mismatch: {key}')
        with db:
            if record['kind'] == 'id':
                def documents():
                    for identifier, row in rows.items():
                        if row.get('id') != identifier:
                            raise RuntimeError('Catalogue ID identity mismatch.')
                        yield identifier, compressor.compress(orjson.dumps(row)), compressor.compress(orjson.dumps(detail_document(row)))
                db.executemany('insert into locations values(?,?,?)', documents())
            else:
                db.executemany('insert into slugs values(?,?)', rows.items())
            db.execute('insert into completed_objects values(?,?,?,?)', (key, record['kind'], record['sha256'], record['count']))
        if ordinal % 32 == 0 or ordinal + 1 == len(records):
            print(f'catalogue_index_progress objects={ordinal+1}/{len(records)} bytes={staged.stat().st_size}', flush=True)
    print('catalogue_index_progress phase=lookup-indexes', flush=True)
    db.execute('create unique index if not exists location_id_lookup on locations(id)')
    db.execute('create unique index if not exists slug_lookup on slugs(slug)')
    db.commit()
    for table in ('locations', 'slugs'):
        if db.execute(f'select count(*) from {table}').fetchone()[0] != expected:
            raise RuntimeError('Catalogue index final count mismatch.')
    if db.execute('select 1 from slugs s left join locations l on l.id=s.location_id where l.id is null limit 1').fetchone():
        raise RuntimeError('Catalogue index contains a dangling slug.')
    if db.execute('pragma quick_check').fetchone()[0] != 'ok':
        raise RuntimeError('Catalogue index integrity check failed.')
    if orjson.loads(get(active_key))['manifest_key'] != original_active_key:
        raise RuntimeError('Active catalogue changed during the build.')
    with db:
        db.execute("update metadata set value='1' where key='complete'")
    db.execute('pragma wal_checkpoint(truncate)')
    db.execute('pragma journal_mode=delete')
    db.close()
    staged.chmod(0o644)
    os.replace(staged, target)
    print(f'catalogue_index_ready=true locations={expected} bytes={target.stat().st_size}', flush=True)


if __name__ == '__main__':
    main()
