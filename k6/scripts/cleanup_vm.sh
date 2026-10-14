#!/usr/bin/env bash
# Remove what a k6 run left on the application VM. Run it ON the VM.
#
#   bash cleanup_vm.sh list   <since-utc>                    # every Prediction created since then
#   bash cleanup_vm.sh dry    <k6-username> <predictionId>...  # what would be deleted
#   bash cleanup_vm.sh apply  <k6-username> <predictionId>...  # delete it
#
# Deletes, for the given Predictions only: their records and rows in PostgreSQL,
# their explain.json.gz in GCS, and their finished Bull jobs in Redis; then the
# k6 user and its tokens. A Prediction has no owner column, so the ids come from
# the K6UPLOAD/K6RUN lines of the run (plus `list` for an interrupted one).
#
# docker needs sudo on the VM; GCS is reached with the VM's service account.
set -euo pipefail

mode="${1:?list | dry | apply}"
shift
PG=postgres-platform
REDIS=redis-platform
BUCKET="${GCS_BUCKET:-microbiome_xai_platform}"
PREFIX="${GCS_PREDICTIONS_PREFIX:-predictions}"

psql() {
  sudo docker exec -i "$PG" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' "$@"
}

if [ "$mode" = list ]; then
  since="${1:?since, e.g. '2026-10-14 10:00:00' (UTC)}"
  psql <<SQL
SELECT p.id, p."createdAt", p."modelName", p."modelVersion", count(r.id) AS records
FROM prediction p LEFT JOIN prediction_record r ON r."predictionId" = p.id
WHERE p."createdAt" >= '$since'
GROUP BY p.id ORDER BY p."createdAt";
SQL
  exit 0
fi

user="${1:?k6 username}"
shift
[ "$#" -gt 0 ] || { echo "no predictionIds given" >&2; exit 1; }
for id in "$@"; do
  [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || { echo "not a uuid: $id" >&2; exit 1; }
done
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "unexpected username: $user" >&2; exit 1; }
ids_sql="$(printf "'%s'," "$@")"; ids_sql="${ids_sql%,}"

echo "== PostgreSQL"
psql <<SQL
SELECT p.id, p."createdAt", p."modelName", count(r.id) AS records
FROM prediction p LEFT JOIN prediction_record r ON r."predictionId" = p.id
WHERE p.id IN ($ids_sql) GROUP BY p.id ORDER BY p."createdAt";
SELECT u.id, u.username, u.role, count(t.id) AS tokens
FROM "user" u LEFT JOIN third_party_token t ON t."userId" = u.id
WHERE u.username = '$user' GROUP BY u.id;
SQL

echo "== GCS"
for id in "$@"; do
  gsutil ls "gs://$BUCKET/$PREFIX/$id/**" 2>/dev/null || echo "(nothing under $PREFIX/$id/)"
done

# One Lua pass: a Bull job is a hash whose `data` names its predictionId.
redis_lua='
local apply = ARGV[1] == "apply"
local found = 0
for _, key in ipairs(redis.call("KEYS", "bull:predictionQueue:*")) do
  if redis.call("TYPE", key).ok == "hash" then
    local data = redis.call("HGET", key, "data")
    if data then
      for i = 2, #ARGV do
        if string.find(data, ARGV[i], 1, true) then
          found = found + 1
          if apply then
            local jobId = string.match(key, "([^:]+)$")
            for _, set in ipairs({"completed", "failed", "delayed", "priority"}) do
              redis.call("ZREM", "bull:predictionQueue:" .. set, jobId)
            end
            for _, list in ipairs({"wait", "active", "paused"}) do
              redis.call("LREM", "bull:predictionQueue:" .. list, 0, jobId)
            end
            redis.call("DEL", key, key .. ":logs", key .. ":lock")
          end
          break
        end
      end
    end
  end
end
return found'
echo "== Redis (Bull jobs for these Predictions)"
sudo docker exec "$REDIS" redis-cli EVAL "$redis_lua" 0 "$mode" "$@"

[ "$mode" = apply ] || { echo; echo "dry run: nothing deleted"; exit 0; }

echo "== deleting"
psql <<SQL
BEGIN;
DELETE FROM prediction_record WHERE "predictionId" IN ($ids_sql);
DELETE FROM prediction WHERE id IN ($ids_sql);
DELETE FROM third_party_token WHERE "userId" IN (SELECT id FROM "user" WHERE username = '$user');
DELETE FROM "user" WHERE username = '$user';
COMMIT;
SQL
for id in "$@"; do
  gsutil -m rm "gs://$BUCKET/$PREFIX/$id/**" 2>/dev/null || true
done
echo "done"
