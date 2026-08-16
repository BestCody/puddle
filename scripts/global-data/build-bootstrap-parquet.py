#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path
import duckdb

parser = argparse.ArgumentParser(description='Convert the Supabase bootstrap NDJSON export into versioned Parquet.')
parser.add_argument('--input', default='.global-data/bootstrap-jsonl')
parser.add_argument('--output', default='.global-data/bootstrap-parquet')
args = parser.parse_args()

source = Path(args.input).resolve()
target = Path(args.output).resolve()
target.mkdir(parents=True, exist_ok=True)
manifest = json.loads((source / 'manifest.json').read_text())
output_manifest = {
    'generatedAt': manifest['generatedAt'],
    'convertedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    'schemaVersion': manifest.get('schemaVersion', 1),
    'tables': {},
}

con = duckdb.connect()
con.execute("SET preserve_insertion_order=false")
con.execute("SET threads TO 4")
for table, metadata in manifest['tables'].items():
    input_file = source / metadata['file']
    output_file = target / f'{table}.parquet'
    escaped_input = str(input_file).replace("'", "''")
    escaped_output = str(output_file).replace("'", "''")
    con.execute(f"COPY (SELECT * FROM read_json_auto('{escaped_input}', format='newline_delimited', union_by_name=true)) TO '{escaped_output}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)")
    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    output_manifest['tables'][table] = {
        'rows': int(metadata['rows']),
        'file': output_file.name,
        'bytes': output_file.stat().st_size,
        'sha256': digest,
    }
    print(f"converted {table}: {metadata['rows']} rows -> {output_file}")

(target / 'manifest.json').write_text(json.dumps(output_manifest, indent=2) + '\n')
print(json.dumps(output_manifest, indent=2))
