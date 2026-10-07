#!/usr/bin/env bash
set -euo pipefail
umask 077

source_host=${1:?Usage: self-host-compare-system-schema.sh SOURCE_DB_HOST}
secret_file=/root/.config/puddle/source-db-password
if [[ ! -s "$secret_file" ]]; then
  printf 'Source database password is not staged.\n' >&2
  exit 1
fi

comparison_dir=$(mktemp -d /root/puddle-migration/schema-XXXXXXXX)
export PGPASSWORD="$(<"$secret_file")" PGSSLMODE=require
query="select table_schema || '.' || table_name, column_name, udt_name from information_schema.columns where table_schema in ('auth', 'storage') order by 1, ordinal_position;"
psql --no-password --host="$source_host" --username=postgres --dbname=postgres \
  --tuples-only --no-align --command="$query" | sort >"$comparison_dir/source.columns"
unset PGPASSWORD
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "$query" | sort >"$comparison_dir/target.columns"

printf 'Columns present only in source:\n'
comm -23 "$comparison_dir/source.columns" "$comparison_dir/target.columns"
printf 'Columns present only in target:\n'
comm -13 "$comparison_dir/source.columns" "$comparison_dir/target.columns"
