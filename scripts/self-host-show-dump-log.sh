#!/usr/bin/env bash
set -euo pipefail

log_file=${1:?Usage: self-host-show-dump-log.sh PRIVATE_LOG_FILE}
case "$log_file" in
  /root/puddle-migration/source-*/roles.log|/root/puddle-migration/source-*/schema.log|/root/puddle-migration/source-*/data.log|/root/puddle-migration/source-*/restore.log) ;;
  *) printf 'Unexpected log path.\n' >&2; exit 1 ;;
esac

secret="$(</root/.config/puddle/source-db-password)"
export PUDDLE_SOURCE_PASSWORD="$secret"
encoded_secret="$(node -e 'process.stdout.write(encodeURIComponent(process.env.PUDDLE_SOURCE_PASSWORD))')"
unset PUDDLE_SOURCE_PASSWORD
while IFS= read -r line; do
  line="${line//"$secret"/[REDACTED]}"
  printf '%s\n' "${line//"$encoded_secret"/[REDACTED]}"
done < <(tail -n 40 "$log_file")
