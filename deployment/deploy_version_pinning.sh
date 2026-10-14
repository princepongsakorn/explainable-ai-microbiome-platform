#!/usr/bin/env bash
# Deploy model-version pinning (branch feat/pin-model-version) to VM #2.
#
# This change touches all three app services, and the order matters:
#
#   1. Inference service first. The new backend calls
#      GET /v1/models/<name>/production when a prediction is created and sends
#      ?version=N on every job; the old runtime has neither. The new runtime
#      still answers the old backend unchanged (no ?version = Production), so
#      running new-runtime + old-backend for a few minutes is safe. The reverse
#      is not: new-backend + old-runtime refuses every new prediction.
#   2. Backend + nginx + frontend, through deploy_all.sh. TypeORM
#      `synchronize: true` adds the two nullable `modelVersion` columns when
#      the backend starts, so no migration is run. Existing rows keep NULL and
#      behave as before.
#   3. Checks that the pinning is live: the runtime rejects a bad ?version with
#      400, the Production lookup answers, and both columns exist.
#
# Jobs already queued in Redis for older predictions have no pinned version and
# keep following Production, exactly as they did.
#
# Usage (from anywhere on the Mac, with the branch checked out):
#   VM_SSH=<user>@<app-vm-host> bash deployment/deploy_version_pinning.sh
#
# Optional:
#   MODEL_NAME=<published model>  model used for the Production lookup check
#                                 (default crc-rynazal-notebook)
#   SKIP_INFERENCE=1 / SKIP_APP=1 skip a stage, e.g. to resume after a failure
#
# Requires what deploy_inference.sh and deploy_all.sh require: ssh + rsync on
# the Mac, the SSH key loaded, sudo for the SSH user on the VM.

set -euo pipefail

VM_SSH="${VM_SSH:?set VM_SSH=<user>@<app-vm-host>}"
MODEL_NAME="${MODEL_NAME:-crc-rynazal-notebook}"
VM_PROJECT_DIR="${VM_PROJECT_DIR:-/home/${VM_SSH%@*}/explainable-ai-microbiome-platform}"
INFERENCE_PORT="${INFERENCE_PORT:-8080}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------- 0. Make sure what gets rsynced is what was reviewed ----------
# The deploy scripts copy the working tree, not a commit. Refuse to ship
# uncommitted edits in the three service folders.
cd "${MAC_REPO_DIR}"
DIRTY="$(git status --porcelain -- kserve-custom-runtime explainable-platform-service explainable-platform)"
if [ -n "${DIRTY}" ]; then
    echo "!! Uncommitted changes in the service folders; commit or stash them first:"
    echo "${DIRTY}"
    exit 1
fi
echo "==> Deploying $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD) to ${VM_SSH}"
echo

# ---------- 1. Inference service ----------
if [ "${SKIP_INFERENCE:-0}" != "1" ]; then
    echo "==> [1/3] inference service"
    VM_SSH="${VM_SSH}" bash "${SCRIPT_DIR}/deploy_inference.sh"
    echo
else
    echo "==> [1/3] inference service: skipped"
fi

# ---------- 2. Backend + nginx + frontend ----------
if [ "${SKIP_APP:-0}" != "1" ]; then
    echo "==> [2/3] backend + nginx + frontend"
    VM_SSH="${VM_SSH}" bash "${SCRIPT_DIR}/deploy_all.sh"
    echo
else
    echo "==> [2/3] backend + nginx + frontend: skipped"
fi

# ---------- 3. Verify pinning is live ----------
# Read-only checks. The two curl calls hit the runtime once each; the
# Production lookup makes one registry request.
echo "==> [3/3] verify version pinning"
ssh -t "${VM_SSH}" "
    FAIL=0

    echo '=== [a] runtime rejects a malformed ?version (expect HTTP 400) ==='
    CODE=\$(curl -s -o /dev/null -w '%{http_code}' -X POST \
        -H 'Content-Type: application/json' -d '{}' \
        'http://127.0.0.1:${INFERENCE_PORT}/v1/predict/${MODEL_NAME}?version=abc')
    echo \"HTTP \$CODE\"
    [ \"\$CODE\" = 400 ] || { echo '!! the runtime on the VM is not the new one'; FAIL=1; }
    echo

    echo '=== [b] Production lookup for ${MODEL_NAME} (expect HTTP 200 + version) ==='
    curl -s -w '\nHTTP %{http_code}\n' \
        'http://127.0.0.1:${INFERENCE_PORT}/v1/models/${MODEL_NAME}/production' || true
    echo

    echo '=== [c] modelVersion columns (expect prediction + prediction_record) ==='
    # Only the user and database names; the password is not needed in-container.
    PG_USER=\$(grep -E '^POSTGRES_USER=' '${VM_PROJECT_DIR}/.env' 2>/dev/null | cut -d= -f2-)
    PG_DB=\$(grep -E '^POSTGRES_DB=' '${VM_PROJECT_DIR}/.env' 2>/dev/null | cut -d= -f2-)
    COLS=\$(sudo docker exec postgres-platform psql \
        -U \"\${PG_USER:-postgres_user}\" -d \"\${PG_DB:-explainable_platform_db}\" -tA \
        -c \"SELECT table_name FROM information_schema.columns WHERE column_name = 'modelVersion' ORDER BY 1\")
    echo \"\$COLS\"
    echo \"\$COLS\" | grep -qx prediction && echo \"\$COLS\" | grep -qx prediction_record \
        || { echo '!! columns missing: check sudo docker logs backend'; FAIL=1; }
    echo

    exit \$FAIL
"

echo
echo "Done. To see it end to end: submit a small CSV, open the prediction, and"
echo "check the list shows '<model> vN' and each Sample's drawer says 'Predicted by <model> vN'."
