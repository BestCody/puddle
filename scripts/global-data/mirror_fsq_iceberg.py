#!/usr/bin/env python3
"""Mirror an FSQ OS bulk release into B2.

The historical FSQ_OS_CONNECTION_SQL secret is supported first so an already-working
Foursquare connection does not have to be re-provisioned. The newer Iceberg token
configuration remains available as an alternative.
"""
import json
import os
import re
from datetime import datetime, timezone

import duckdb


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


def clean_prefix(value):
    return '/'.join(part for part in str(value or '').strip('/').split('/') if part)


LEGACY_SQL = first_env('FSQ_OS_CONNECTION_SQL')
TOKEN = first_env('FSQ_ICEBERG_TOKEN')
ENDPOINT = first_env('FSQ_ICEBERG_ENDPOINT', default='https://h3-hub-foursquare.acryl.io/gms/iceberg/')
CATALOG = first_env('FSQ_ICEBERG_CATALOG', default='open_h3')
TABLE = first_env('FSQ_OS_TABLE', 'FSQ_ICEBERG_TABLE')
DELTA_TABLE = first_env('FSQ_ICEBERG_DELTA_TABLE')
RELEASE = first_env('FSQ_RELEASE_LABEL')
DATA_PREFIX = clean_prefix(first_env('B2_DATA_PREFIX', default='data'))
B2_ENDPOINT_URL = required(first_env('B2_DATA_S3_ENDPOINT', 'B2_S3_ENDPOINT'), 'B2 S3 endpoint')
B2_ENDPOINT = B2_ENDPOINT_URL.replace('https://', '').replace('http://', '').rstrip('/')
B2_KEY_ID = required(first_env('B2_DATA_KEY_ID', 'B2_DATA_APPLICATION_KEY_ID', 'B2_KEY_ID'), 'B2 key ID')
B2_KEY = required(first_env('B2_DATA_APPLICATION_KEY', 'B2_APPLICATION_KEY'), 'B2 application key')
B2_BUCKET = first_env('B2_DATA_BUCKET_NAME', 'B2_BUCKET', default='puddle-assets')
B2_REGION = first_env('B2_DATA_S3_REGION', 'B2_REGION', default='us-east-005')

identifier = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$')


def safe_identifier(value):
    if not identifier.match(value):
        raise RuntimeError(f'Unsafe FSQ table identifier: {value}')
    return value


def qualify_discovered_table(catalog, schema, name):
    parts = [part for part in (catalog, schema, name) if part]
    for part in parts:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', part):
            raise RuntimeError(f'Unsafe discovered FSQ identifier component: {part}')
    return '.'.join(parts)


con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute('SET threads TO 8')
con.execute('SET preserve_insertion_order=false')
connection_mode = None

if LEGACY_SQL:
    # This value is a repository secret controlled by Puddle operators. It is never
    # printed or persisted in manifests. It is treated as connection configuration,
    # not provider data.
    con.execute(LEGACY_SQL)
    connection_mode = 'legacy_connection_sql'
else:
    if not TOKEN:
        raise RuntimeError('Configure existing FSQ_OS_CONNECTION_SQL or the newer FSQ_ICEBERG_TOKEN connection.')
    con.execute('INSTALL iceberg; LOAD iceberg;')
    con.execute(f"""
    CREATE OR REPLACE SECRET fsq_iceberg_secret (
      TYPE ICEBERG,
      TOKEN '{TOKEN.replace("'", "''")}'
    );
    ATTACH '{CATALOG.replace("'", "''")}' AS fsq_catalog (
      TYPE iceberg,
      SECRET fsq_iceberg_secret,
      ENDPOINT '{ENDPOINT.replace("'", "''")}'
    );
    """)
    connection_mode = 'iceberg_token'

con.execute(f"""
CREATE OR REPLACE SECRET b2_data_secret (
  TYPE S3,
  KEY_ID '{B2_KEY_ID.replace("'", "''")}',
  SECRET '{B2_KEY.replace("'", "''")}',
  REGION '{B2_REGION.replace("'", "''")}',
  ENDPOINT '{B2_ENDPOINT.replace("'", "''")}',
  URL_STYLE 'path',
  USE_SSL true
);
""")

if TABLE:
    source_table = safe_identifier(TABLE)
    if connection_mode == 'iceberg_token' and source_table.count('.') == 1:
        qualified = f'fsq_catalog.{source_table}'
    else:
        qualified = source_table
else:
    rows = con.execute("""
      SELECT table_catalog, table_schema, table_name
      FROM information_schema.tables
      WHERE lower(table_name) LIKE '%place%'
        AND table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY
        CASE WHEN lower(table_name) IN ('places', 'place') THEN 0 ELSE 1 END,
        CASE WHEN lower(table_catalog) LIKE '%fsq%' OR lower(table_catalog) LIKE '%four%' THEN 0 ELSE 1 END,
        table_catalog, table_schema, table_name
    """).fetchall()
    if not rows:
        hint = 'FSQ_OS_TABLE' if connection_mode == 'legacy_connection_sql' else 'FSQ_ICEBERG_TABLE'
        raise RuntimeError(f'No FSQ Places table was discovered after connecting. Set {hint} explicitly.')
    catalog, schema, name = rows[0]
    qualified = qualify_discovered_table(catalog, schema, name)
    TABLE = qualified

columns = {row[0] for row in con.execute(f'DESCRIBE SELECT * FROM {qualified} LIMIT 0').fetchall()}
id_candidates = {'fsq_place_id', 'id'}
if not columns.intersection(id_candidates) or 'name' not in columns:
    raise RuntimeError(f'Resolved FSQ table {qualified} does not contain a recognizable place ID and name.')

if not RELEASE:
    if 'date_refreshed' in columns:
        value = con.execute(f"SELECT strftime(max(try_cast(date_refreshed AS TIMESTAMP)), '%Y-%m-%d') FROM {qualified}").fetchone()[0]
        RELEASE = value or datetime.now(timezone.utc).date().isoformat()
    else:
        RELEASE = datetime.now(timezone.utc).date().isoformat()

raw_prefix = f's3://{B2_BUCKET}/{DATA_PREFIX}/raw/fsq/release={RELEASE}/places'
con.execute(f"""
COPY (SELECT * FROM {qualified})
TO '{raw_prefix}'
(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PER_THREAD_OUTPUT true, OVERWRITE_OR_IGNORE true);
""")

if DELTA_TABLE and connection_mode == 'iceberg_token':
    delta = safe_identifier(DELTA_TABLE)
    qualified_delta = f'fsq_catalog.{delta}' if delta.count('.') == 1 else delta
    con.execute(f"""
    COPY (SELECT * FROM {qualified_delta})
    TO 's3://{B2_BUCKET}/{DATA_PREFIX}/raw/fsq/release={RELEASE}/deltas'
    (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PER_THREAD_OUTPUT true, OVERWRITE_OR_IGNORE true);
    """)

manifest = {
    'source': 'fsq_os',
    'release': RELEASE,
    'mirroredAt': datetime.now(timezone.utc).isoformat(),
    'connectionMode': connection_mode,
    'table': TABLE,
    'deltaTable': DELTA_TABLE or None,
    'rawPrefix': raw_prefix,
}
manifest_json = json.dumps(manifest, separators=(',', ':'))
escaped = manifest_json.replace("'", "''")
con.execute(
    f"COPY (SELECT '{escaped}' AS json) TO 's3://{B2_BUCKET}/{DATA_PREFIX}/raw/fsq/release={RELEASE}/manifest.parquet' "
    "(FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)"
)
print(json.dumps(manifest, indent=2))
if os.getenv('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('fsq_release=' + str(RELEASE) + '\n')
