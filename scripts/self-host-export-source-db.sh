#!/usr/bin/env bash
set -euo pipefail
umask 077

source_host=${1:?Usage: self-host-export-source-db.sh SOURCE_DB_HOST}
secret_file=/root/.config/puddle/source-db-password
if [[ ! -s "$secret_file" ]]; then
  printf 'Source database password is not staged.\n' >&2
  exit 1
fi

mkdir -p -m 0700 /root/puddle-migration
exec 9>/root/puddle-migration/source-export.lock
flock -n 9 || { printf 'A source database export is already running.\n' >&2; exit 1; }

snapshot_dir=$(mktemp -d /root/puddle-migration/source-XXXXXXXX)
password="$(<"$secret_file")"
export PUDDLE_SOURCE_PASSWORD="$password"
encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.env.PUDDLE_SOURCE_PASSWORD))')"
unset PUDDLE_SOURCE_PASSWORD
source_url="postgresql://postgres:${encoded_password}@${source_host}:5432/postgres?sslmode=require"

dump_phase() {
  local phase=$1
  shift
  if ! npx --yes supabase@2.115.0 db dump \
    --network-id host --db-url "$source_url" \
    --file "$snapshot_dir/$phase.sql" "$@" \
    >"$snapshot_dir/$phase.log" 2>&1; then
    printf '%s export failed; private log: %s\n' "$phase" "$snapshot_dir/$phase.log" >&2
    exit 1
  fi
  if [[ ! -s "$snapshot_dir/$phase.sql" ]]; then
    printf '%s export produced an empty file.\n' "$phase" >&2
    exit 1
  fi
  printf '%s exported (%s bytes).\n' "$phase" "$(stat -c %s "$snapshot_dir/$phase.sql")"
}

dump_phase roles --role-only
dump_phase schema
dump_phase data --use-copy --data-only
sha256sum "$snapshot_dir"/{roles,schema,data}.sql >"$snapshot_dir/SHA256SUMS"
printf 'Source rehearsal export complete: %s\n' "$snapshot_dir"
