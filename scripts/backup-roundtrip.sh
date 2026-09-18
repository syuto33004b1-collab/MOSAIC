#!/usr/bin/env bash
# Local dump → empty Supabase-shaped restore → fingerprint compare (#416).
#
# What this is
#   The operational restore drill. It always creates a fresh source from the
#   pinned Postgres image and this checkout's migrations, dumps with the
#   pinned CLI, restores into a second fresh image that already has `auth` /
#   `extensions`, and diffs `scripts/backup-restore-check.sql`.
#
# What this is not
#   Not a production dump or restore. It does not read SUPABASE_DB_URL, does
#   not accept a remote URL, and does not upload Actions artifacts.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

for arg in "$@"; do
  case "$arg" in
    --linked|--project-ref|--db-url|--db-url=*|--project-ref=*|--linked=*)
      echo "backup-roundtrip.sh dumps --local only. Refusing $arg." >&2
      exit 2
      ;;
  esac
done

if [[ -n "${SUPABASE_DB_URL:-}" || -n "${MOSAIC_BACKUP_SOURCE_URL:-}" || -n "${MOSAIC_BACKUP_RESTORE_URL:-}" ]]; then
  echo "refusing override URLs. This script uses loopback ports 54322 and 55432 only." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 3
fi

workdir="${MOSAIC_BACKUP_WORKDIR:-/tmp/mosaic-backup-roundtrip}"
case "$workdir" in
  /tmp/mosaic-backup-roundtrip|/tmp/mosaic-backup-roundtrip/*) ;;
  *)
    echo "workdir must be /tmp/mosaic-backup-roundtrip or a child of it." >&2
    exit 2
    ;;
esac
rm -rf "$workdir"
mkdir -p "$workdir"

cli=(npm exec --yes -- supabase --)
source_url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
restore_url="postgresql://postgres:postgres@127.0.0.1:55432/postgres"
image="${MOSAIC_BACKUP_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.167}"
case "$image" in
  public.ecr.aws/supabase/postgres:*) ;;
  *)
    echo "image must be public.ecr.aws/supabase/postgres:<tag>." >&2
    exit 2
    ;;
esac

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

start_fresh() {
  local name="$1"
  local port="$2"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_HOST=/var/run/postgresql \
    -e JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
    -p "${port}:5432" \
    "$image" >/dev/null
}

echo "== fresh source $image on 54322 =="
start_fresh mosaic_src 54322
wait_pg "$source_url"
if ! psql_url "$source_url" -tAc "select to_regclass('auth.users')" | grep -q auth; then
  echo "source image is missing auth.users" >&2
  exit 1
fi

echo "== apply this checkout's migrations =="
for f in "$root"/supabase/migrations/*.sql; do
  psql_url "$source_url" -f "$f"
done
psql_url "$source_url" -f "$root/scripts/backup-roundtrip-seed.sql"

echo "== dump, then fingerprint the quiesced source =="
"${cli[@]}" db dump --local -f "$workdir/schema.sql"
"${cli[@]}" db dump --local --data-only --use-copy -f "$workdir/data.sql"
psql_url "$source_url" -f "$root/scripts/backup-restore-check.sql" > "$workdir/source.json"

echo "== fresh empty supabase-shaped target on 55432 =="
start_fresh mosaic_dst 55432
wait_pg "$restore_url"
if psql_url "$restore_url" -tAc "select to_regclass('app.organizations')" | grep -q organizations; then
  echo "restore target already has app.organizations; refusing a dirty target" >&2
  exit 1
fi

echo "== restore schema.sql + data.sql =="
psql_url "$restore_url" -f "$workdir/schema.sql"
psql_url "$restore_url" -c "set session_replication_role = replica;" -f "$workdir/data.sql"
psql_url "$restore_url" -f "$root/scripts/backup-restore-check.sql" > "$workdir/restored.json"

python3 - <<PY
import json, pathlib, subprocess
workdir = pathlib.Path("$workdir")
source = json.loads(workdir.joinpath("source.json").read_text())
restored = json.loads(workdir.joinpath("restored.json").read_text())
cli = subprocess.check_output(["npm", "exec", "--yes", "--", "supabase", "--", "--version"], text=True).strip()
auth_tables = sorted(k for k in source.get("table_counts", {}) if k.startswith("auth."))
report = {
  "cli": cli,
  "image": "$image",
  "default_schema_schemas": ["app", "private"],
  "auth_tables_in_fingerprint": auth_tables,
  "fingerprint_match": source == restored,
  "fk_orphan_total_source": source.get("fk_orphan_total"),
  "fk_orphan_total_restored": restored.get("fk_orphan_total"),
  "fk_constraint_count_source": source.get("fk_constraint_count"),
  "workdir": str(workdir),
}
workdir.joinpath("measured-scope.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
if source != restored:
    raise SystemExit(1)
if source.get("fk_orphan_total") != 0:
    raise SystemExit(1)
PY

echo "restore fingerprint matched. report: $workdir/measured-scope.json"
