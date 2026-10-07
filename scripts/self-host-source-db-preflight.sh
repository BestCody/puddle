#!/usr/bin/env bash
set -euo pipefail

secret_file=/root/.config/puddle/source-db-password
source_host=${1:?Usage: self-host-source-db-preflight.sh SOURCE_DB_HOST}
mode=${2:-users}

if [[ ! -s "$secret_file" ]]; then
  printf 'Source database password is not staged.\n' >&2
  exit 1
fi

export PGPASSWORD
PGPASSWORD="$(<"$secret_file")"
export PGSSLMODE=require

case "$mode" in
  users)
    query='select count(*) from auth.users;'
    ;;
  dump-activity)
    query="select pid, state, coalesce(wait_event_type, '-'), coalesce(wait_event, '-'), now() - state_change, left(query, 120) from pg_stat_activity where application_name = 'pg_dump' order by pid;"
    ;;
  extensions)
    query='select extname, extversion, extnamespace::regnamespace from pg_extension order by extname;'
    ;;
  system-tables)
    query="select table_schema || '.' || table_name from information_schema.tables where table_schema in ('auth', 'storage') and table_type = 'BASE TABLE' order by 1;"
    ;;
  missing-auth-counts)
    query="select 'mfa_recovery_code_sets', count(*) from auth.mfa_recovery_code_sets union all select 'mfa_recovery_codes', count(*) from auth.mfa_recovery_codes union all select 'scim_tokens', count(*) from auth.scim_tokens union all select 'scim_users', count(*) from auth.scim_users order by 1;"
    ;;
  one-time-tokens)
    query='select count(*), count(*) filter (where expires_at > now()) from auth.one_time_tokens;'
    ;;
  system-columns)
    query="select table_schema || '.' || table_name, column_name, udt_name from information_schema.columns where table_schema in ('auth', 'storage') order by 1, ordinal_position;"
    ;;
  *)
    printf 'Unknown preflight mode.\n' >&2
    exit 1
    ;;
esac

psql --no-password --host="$source_host" --username=postgres --dbname=postgres \
  --tuples-only --no-align --command="$query"
