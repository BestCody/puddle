#!/usr/bin/env bash
set -euo pipefail
umask 077

source_host=${1:?Usage: self-host-verify-restored-counts.sh SOURCE_DB_HOST SOURCE_SNAPSHOT_DIR}
snapshot_dir=${2:?Usage: self-host-verify-restored-counts.sh SOURCE_DB_HOST SOURCE_SNAPSHOT_DIR}
case "$snapshot_dir" in
  /root/puddle-migration/source-*) ;;
  *) printf 'Unexpected source snapshot path.\n' >&2; exit 1 ;;
esac

query_file=/opt/puddle-stage/verify-restored-row-counts.sql
export PGPASSWORD="$(</root/.config/puddle/source-db-password)" PGSSLMODE=require
psql --no-password --host="$source_host" --username=postgres --dbname=postgres \
  -X -A -t -v ON_ERROR_STOP=1 --file "$query_file" >"$snapshot_dir/source-row-counts.txt"
unset PGPASSWORD

docker cp "$query_file" supabase-db:/tmp/verify-restored-row-counts.sql >/dev/null
docker exec supabase-db psql -U supabase_admin -d postgres \
  -X -A -t -v ON_ERROR_STOP=1 --file /tmp/verify-restored-row-counts.sql \
  >"$snapshot_dir/target-row-counts.txt"

printf 'Source and staging row counts:\n'
wc -l "$snapshot_dir/source-row-counts.txt" "$snapshot_dir/target-row-counts.txt"
status=0
diff -u "$snapshot_dir/source-row-counts.txt" "$snapshot_dir/target-row-counts.txt" || status=1

security_query=/opt/puddle-stage/verify-restored-security.sql
export PGPASSWORD="$(</root/.config/puddle/source-db-password)" PGSSLMODE=require
psql --no-password --host="$source_host" --username=postgres --dbname=postgres \
  -X -A -t -v ON_ERROR_STOP=1 --file "$security_query" >"$snapshot_dir/source-security.txt"
unset PGPASSWORD
docker cp "$security_query" supabase-db:/tmp/verify-restored-security.sql >/dev/null
docker exec supabase-db psql -U supabase_admin -d postgres \
  -X -A -t -v ON_ERROR_STOP=1 --file /tmp/verify-restored-security.sql \
  >"$snapshot_dir/target-security.txt"
if cmp -s "$snapshot_dir/source-security.txt" "$snapshot_dir/target-security.txt"; then
  printf 'Public RLS policies and Storage bucket definitions match.\n'
else
  printf 'Public RLS or Storage bucket definitions differ; inspect private reports.\n' >&2
  status=1
fi
exit "$status"
