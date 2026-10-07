#!/usr/bin/env bash
set -euo pipefail
umask 077

snapshot_dir=${1:?Usage: self-host-restore-source-db.sh SOURCE_SNAPSHOT_DIR}
data_file=${2:-data.sql}
case "$snapshot_dir" in
  /root/puddle-migration/source-*) ;;
  *) printf 'Unexpected source snapshot path.\n' >&2; exit 1 ;;
esac
case "$data_file" in
  data.sql|data.compat.sql) ;;
  *) printf 'Unexpected data file.\n' >&2; exit 1 ;;
esac

(cd "$snapshot_dir" && sha256sum -c SHA256SUMS >/dev/null)
if [[ "$(docker exec supabase-db psql -U postgres -d postgres -X -A -t -c 'select count(*) from auth.users')" != 0 ]]; then
  printf 'Staging already has Auth users; refusing a second restore.\n' >&2
  exit 1
fi

docker exec supabase-db mkdir -p -m 0700 /tmp/puddle-restore
for phase in roles schema; do
  docker cp "$snapshot_dir/$phase.sql" "supabase-db:/tmp/puddle-restore/$phase.sql" >/dev/null
done
docker cp "$snapshot_dir/$data_file" supabase-db:/tmp/puddle-restore/data.sql >/dev/null

restore_log="$snapshot_dir/restore.log"
if ! docker exec supabase-db psql -U supabase_admin -d postgres -X \
  --single-transaction --variable ON_ERROR_STOP=1 \
  --file /tmp/puddle-restore/roles.sql \
  --file /tmp/puddle-restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file /tmp/puddle-restore/data.sql \
  >"$restore_log" 2>&1; then
  printf 'Staging restore failed; private log: %s\n' "$restore_log" >&2
  exit 1
fi

docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'auth_users|' || count(*) from auth.users union all select 'storage_objects|' || count(*) from storage.objects;"
printf 'Staging restore complete.\n'
