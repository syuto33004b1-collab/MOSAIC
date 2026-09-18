#!/usr/bin/env bash
# Local dump → empty Supabase-shaped restore → fingerprint compare (#416).
#
# What this is
#   The operational restore drill. It loads a tiny fixture, dumps with the
#   pinned CLI, restores into a second empty database that already has the
#   platform `auth` / `extensions` schemas, and diffs
#   `scripts/backup-restore-check.sql`. The 2026-09-18 measurement is in
#   OPERATIONS.md: default schema dump is `app`+`private`; default data dump
#   includes `auth.users`; community Postgres without those schemas fails.
#
# What this is not
#   Not a production dump. It refuses `--linked`, `--project-ref`, and
#   `--db-url`. It does not upload Actions artifacts. It does not decide
#   the offsite bucket.
#
# Usage
#   scripts/backup-roundtrip.sh
#   MOSAIC_BACKUP_WORKDIR=/tmp/mosaic-backup-roundtrip scripts/backup-roundtrip.sh

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

for arg in "$@"; do
  case "$arg" in
    --linked|--project-ref|--db-url|--db-url=*|--project-ref=*)
      echo "backup-roundtrip.sh dumps --local only. Refusing $arg." >&2
      exit 2
      ;;
  esac
done

if [[ -n "${SUPABASE_DB_URL:-}" && "${MOSAIC_BACKUP_ALLOW_REMOTE:-}" != "1" ]]; then
  echo "SUPABASE_DB_URL is set. This script is local-only unless MOSAIC_BACKUP_ALLOW_REMOTE=1." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 3
fi

workdir="${MOSAIC_BACKUP_WORKDIR:-/tmp/mosaic-backup-roundtrip}"
rm -rf "$workdir"
mkdir -p "$workdir"

cli=(npm exec --yes -- supabase --)
source_url="${MOSAIC_BACKUP_SOURCE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
restore_url="${MOSAIC_BACKUP_RESTORE_URL:-postgresql://postgres:postgres@127.0.0.1:55432/postgres}"
image="${MOSAIC_BACKUP_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.167}"

psql_url() {
  local url="$1"
  shift
  psql "$url" -v ON_ERROR_STOP=1 -X -q "$@"
}

wait_pg() {
  local url="$1"
  local n=0
  while (( n < 60 )); do
    if psql "$url" -v ON_ERROR_STOP=1 -X -q -c "select 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    n=$((n + 1))
  done
  echo "postgres did not accept connections: $url" >&2
  return 1
}

ensure_source() {
  if psql_url "$source_url" -c "select to_regclass('app.organizations')" >/dev/null 2>&1; then
    echo "using existing source at $source_url"
    return 0
  fi

  echo "== supabase db start (same as CI when it works) =="
  if "${cli[@]}" db start; then
    wait_pg "$source_url"
    return 0
  fi

  echo "== fallback: start $image as mosaic_src =="
  docker rm -f mosaic_src >/dev/null 2>&1 || true
  docker run -d --name mosaic_src \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_HOST=/var/run/postgresql \
    -e JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
    -p 54322:5432 \
    "$image" >/dev/null
  wait_pg "$source_url"
  if ! psql_url "$source_url" -tAc "select to_regclass('app.organizations')" | grep -q organizations; then
    echo "== apply migrations =="
    local f
    for f in "$root"/supabase/migrations/*.sql; do
      psql_url "$source_url" -f "$f"
    done
  fi
}

ensure_restore_target() {
  if psql_url "$restore_url" -tAc "select to_regclass('auth.users')" 2>/dev/null | grep -q auth \
    && ! psql_url "$restore_url" -tAc "select to_regclass('app.organizations')" 2>/dev/null | grep -q organizations; then
    echo "using existing empty supabase-shaped target at $restore_url"
    return 0
  fi

  echo "== start empty supabase-shaped target $image as mosaic_dst =="
  docker rm -f mosaic_dst >/dev/null 2>&1 || true
  docker run -d --name mosaic_dst \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_HOST=/var/run/postgresql \
    -e JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
    -p 55432:5432 \
    "$image" >/dev/null
  wait_pg "$restore_url"
}

ensure_source

echo "== reset fixture =="
if "${cli[@]}" db reset --yes --no-seed --local >/dev/null 2>&1; then
  :
else
  echo "db reset unavailable; applying seed onto current source"
fi
psql_url "$source_url" -f "$root/scripts/backup-roundtrip-seed.sql"

echo "== source fingerprint =="
psql_url "$source_url" -f "$root/scripts/backup-restore-check.sql" > "$workdir/source.json"

echo "== dump default schema and data =="
"${cli[@]}" db dump --local -f "$workdir/schema.sql"
"${cli[@]}" db dump --local --data-only --use-copy -f "$workdir/data.sql"

ensure_restore_target

echo "== restore schema.sql + data.sql onto supabase-shaped empty DB =="
psql_url "$restore_url" -f "$workdir/schema.sql"
psql_url "$restore_url" -c "set session_replication_role = replica;" -f "$workdir/data.sql"

echo "== restored fingerprint =="
psql_url "$restore_url" -f "$root/scripts/backup-restore-check.sql" > "$workdir/restored.json"

python3 - <<PY
import json, pathlib
workdir = pathlib.Path("$workdir")
source = json.loads(workdir.joinpath("source.json").read_text())
restored = json.loads(workdir.joinpath("restored.json").read_text())
report = {
  "cli": "supabase 2.117.0 (repo pin)",
  "image": "$image",
  "default_schema_schemas": ["app", "private"],
  "fingerprint_match": source == restored,
  "fk_orphan_total_source": source.get("fk_orphan_total"),
  "fk_orphan_total_restored": restored.get("fk_orphan_total"),
  "workdir": str(workdir),
}
workdir.joinpath("measured-scope.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
if source != restored:
    raise SystemExit(1)
PY

echo "restore fingerprint matched. report: $workdir/measured-scope.json"
