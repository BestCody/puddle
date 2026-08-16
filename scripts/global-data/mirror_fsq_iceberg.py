#!/usr/bin/env python3
import json
import os
import re
from datetime import datetime, timezone
import duckdb

TOKEN = os.environ['FSQ_ICEBERG_TOKEN']
ENDPOINT = os.getenv('FSQ_ICEBERG_ENDPOINT', 'https://h3-hub-foursquare.acryl.io/gms/iceberg/')
CATALOG = os.getenv('FSQ_ICEBERG_CATALOG', 'open_h3')
TABLE = os.getenv('FSQ_ICEBERG_TABLE', '').strip()
DELTA_TABLE = os.getenv('FSQ_ICEBERG_DELTA_TABLE', '').strip()
RELEASE = os.getenv('FSQ_RELEASE_LABEL', '').strip()
B2_ENDPOINT = os.environ['B2_DATA_S3_ENDPOINT'].replace('https://', '').replace('http://', '').rstrip('/')
B2_KEY_ID = os.getenv('B2_DATA_KEY_ID') or os.environ['B2_DATA_APPLICATION_KEY_ID']
B2_KEY = os.environ['B2_DATA_APPLICATION_KEY']
B2_BUCKET = os.environ['B2_DATA_BUCKET_NAME']
B2_REGION = os.getenv('B2_DATA_S3_REGION', 'us-west-004')

identifier = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$')

def safe_identifier(value):
    if not identifier.match(value):
        raise RuntimeError(f'Unsafe Iceberg table identifier: {value}')
    return value

con = duckdb.connect()
con.execute('INSTALL iceberg; LOAD iceberg; INSTALL httpfs; LOAD httpfs;')
con.execute("SET threads TO 8")
con.execute("SET preserve_insertion_order=false")
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

if not TABLE:
    rows = con.execute("""
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_catalog = 'fsq_catalog'
        AND lower(table_name) LIKE '%place%'
      ORDER BY CASE WHEN lower(table_name) = 'places' THEN 0 ELSE 1 END, table_schema, table_name
    """).fetchall()
    if not rows:
        raise RuntimeError('No FSQ Places table was found. Set FSQ_ICEBERG_TABLE to the table shown in the Places Portal DuckDB snippet.')
    schema, name = rows[0]
    TABLE = f'{schema}.{name}'

source_table = safe_identifier(TABLE)
if source_table.count('.') == 1:
    qualified = f'fsq_catalog.{source_table}'
elif source_table.count('.') == 2:
    qualified = source_table
else:
    raise RuntimeError('FSQ_ICEBERG_TABLE must be schema.table when supplied explicitly.')

if not RELEASE:
    table_columns = {row[0] for row in con.execute(f'DESCRIBE SELECT * FROM {qualified} LIMIT 0').fetchall()}
    if 'date_refreshed' in table_columns:
        value = con.execute(f"SELECT strftime(max(try_cast(date_refreshed AS TIMESTAMP)), '%Y-%m-%d') FROM {qualified}").fetchone()[0]
        RELEASE = value or datetime.now(timezone.utc).date().isoformat()
    else:
        RELEASE = datetime.now(timezone.utc).date().isoformat()
raw_prefix = f's3://{B2_BUCKET}/raw/fsq/release={RELEASE}/places'

# FSQ OS is already a bulk dataset; keep a lossless Parquet mirror rather than issuing per-POI API calls.
con.execute(f"""
COPY (SELECT * FROM {qualified})
TO '{raw_prefix}'
(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PER_THREAD_OUTPUT true, OVERWRITE_OR_IGNORE true);
""")

if DELTA_TABLE:
    delta = safe_identifier(DELTA_TABLE)
    if delta.count('.') == 1:
        qualified_delta = f'fsq_catalog.{delta}'
    elif delta.count('.') == 2:
        qualified_delta = delta
    else:
        raise RuntimeError('FSQ_ICEBERG_DELTA_TABLE must be schema.table when supplied.')
    con.execute(f"""
    COPY (SELECT * FROM {qualified_delta})
    TO 's3://{B2_BUCKET}/raw/fsq/release={RELEASE}/deltas'
    (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000, PER_THREAD_OUTPUT true, OVERWRITE_OR_IGNORE true);
    """)

manifest = {
    'source': 'fsq_os', 'release': RELEASE, 'mirroredAt': datetime.now(timezone.utc).isoformat(),
    'catalog': CATALOG, 'table': TABLE, 'deltaTable': DELTA_TABLE or None,
    'rawPrefix': raw_prefix,
}
manifest_json = json.dumps(manifest, separators=(',', ':'))
escaped = manifest_json.replace("'", "''")
con.execute(f"COPY (SELECT '{escaped}' AS json) TO 's3://{B2_BUCKET}/raw/fsq/release={RELEASE}/manifest.parquet' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE true)")
print(json.dumps(manifest, indent=2))
if os.getenv('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('fsq_release=' + str(RELEASE) + '\n')
