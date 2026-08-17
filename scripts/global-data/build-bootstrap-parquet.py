#!/usr/bin/env python3
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb

parser = argparse.ArgumentParser(description='Convert the Supabase bootstrap NDJSON export into validated, versioned Parquet.')
parser.add_argument('--input', default='.global-data/bootstrap-jsonl')
parser.add_argument('--output', default='.global-data/bootstrap-parquet')
args = parser.parse_args()

source = Path(args.input).resolve()
target = Path(args.output).resolve()
target.mkdir(parents=True, exist_ok=True)
manifest = json.loads((source / 'manifest.json').read_text())
output_manifest = {
    'generatedAt': manifest['generatedAt'],
    'convertedAt': datetime.now(timezone.utc).isoformat(),
    'schemaVersion': manifest.get('schemaVersion', 1),
    'tables': {},
    'validation': {},
}

con = duckdb.connect()
con.execute("SET preserve_insertion_order=false")
con.execute("SET threads TO 4")
for table, metadata in manifest['tables'].items():
    input_file = source / metadata['file']
    output_file = target / f'{table}.parquet'
    escaped_input = str(input_file).replace("'", "''")
    escaped_output = str(output_file).replace("'", "''")
    # Source identifiers can look numeric in early rows and be alphanumeric later.
    # Scan the complete NDJSON export for type inference so DuckDB does not infer
    # an integer from its default sample and reject valid string identifiers later.
    con.execute(
        f"COPY (SELECT * FROM read_json_auto('{escaped_input}', format='newline_delimited', union_by_name=true, sample_size=-1)) "
        f"TO '{escaped_output}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)"
    )
    actual_rows = int(con.execute(f"SELECT count(*) FROM read_parquet('{escaped_output}')").fetchone()[0])
    expected_rows = int(metadata['rows'])
    if actual_rows != expected_rows:
        raise RuntimeError(f'{table} row-count mismatch: export manifest={expected_rows}, parquet={actual_rows}')
    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    output_manifest['tables'][table] = {
        'rows': actual_rows,
        'file': output_file.name,
        'bytes': output_file.stat().st_size,
        'sha256': digest,
    }
    print(f"converted {table}: {actual_rows} rows -> {output_file}")


def parquet(table):
    path = (target / f'{table}.parquet').as_posix().replace("'", "''")
    return f"read_parquet('{path}')"


# The bootstrap is the identity bridge into the global catalogue. Fail before upload
# if the current location table does not provide a one-to-one stable ID set.
location_rows, nonnull_ids, unique_ids = con.execute(
    f"SELECT count(*), count(id), count(DISTINCT cast(id AS VARCHAR)) FROM {parquet('locations')}"
).fetchone()
if location_rows != nonnull_ids or location_rows != unique_ids:
    raise RuntimeError(
        f'locations stable-ID validation failed: rows={location_rows}, nonnull_ids={nonnull_ids}, unique_ids={unique_ids}'
    )

source_link_rows = int(con.execute(f"SELECT count(*) FROM {parquet('location_source_links')}").fetchone()[0])
source_link_locations = int(con.execute(f"SELECT count(DISTINCT cast(location_id AS VARCHAR)) FROM {parquet('location_source_links')}").fetchone()[0])
photo_rows = int(con.execute(f"SELECT count(*) FROM {parquet('location_photo_sources')}").fetchone()[0])
google_rows = int(con.execute(f"SELECT count(*) FROM {parquet('location_google_places')}").fetchone()[0])
verified_google_rows = int(con.execute(
    f"SELECT count(*) FROM {parquet('location_google_places')} WHERE lower(coalesce(cast(status AS VARCHAR),''))='verified' AND google_place_id IS NOT NULL"
).fetchone()[0])

# Source links must not point at a location ID that disappeared from the bootstrap.
orphan_source_links = int(con.execute(f"""
SELECT count(*)
FROM {parquet('location_source_links')} s
LEFT JOIN {parquet('locations')} l ON cast(l.id AS VARCHAR)=cast(s.location_id AS VARCHAR)
WHERE l.id IS NULL
""").fetchone()[0])
if orphan_source_links:
    raise RuntimeError(f'bootstrap contains {orphan_source_links} source links whose location_id is missing from locations')

output_manifest['validation'] = {
    'locations': {'rows': int(location_rows), 'uniqueStableIds': int(unique_ids)},
    'sourceLinks': {'rows': source_link_rows, 'distinctLocations': source_link_locations, 'orphans': orphan_source_links},
    'photoMetadataRows': photo_rows,
    'googlePlaceRows': google_rows,
    'verifiedGooglePlaceIds': verified_google_rows,
    'allParquetRowCountsMatchExport': True,
}

(target / 'manifest.json').write_text(json.dumps(output_manifest, indent=2) + '\n')
print(json.dumps(output_manifest, indent=2))
