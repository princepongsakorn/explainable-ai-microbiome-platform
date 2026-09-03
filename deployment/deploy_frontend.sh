#!/usr/bin/env bash
# Deploy only the Next.js frontend (explainable-platform/) to VM #2.
#
# - Rsync the frontend folder from Mac to the VM, preserving --delete semantics
#   so removed files on Mac are removed on the VM (same as the recipe we used
#   in the past deploy session).
# - SSH into the VM and rebuild + force-recreate ONLY the `frontend` service in
#   docker-compose.prod.yml. Backend/postgres/redis are left untouched.
# - Run the 5-layer health check so any breakage shows up immediately.
#
# Usage (from anywhere on the Mac):
#   bash ~/MasterProject/project/explainable-ai-microbiome-platform/deployment/deploy_frontend.sh
#
# Override the SSH target if it ever changes:
#   VM_SSH=print@new-host bash deploy_frontend.sh
#
# Requires: ssh + rsync on the Mac, and the matching SSH key already loaded
# (this is the same setup that worked in the prior deploy).

set -euo pipefail

VM_SSH="${VM_SSH:-print@35.239.175.89}"
VM_PROJECT_DIR="${VM_PROJECT_DIR:-/home/print/explainable-ai-microbiome-platform}"
MAC_REPO_DIR="${MAC_REPO_DIR:-$HOME/MasterProject/project/explainable-ai-microbiome-platform}"

echo "==> Mac source: ${MAC_REPO_DIR}/explainable-platform/"
echo "==> Remote   : ${VM_SSH}:${VM_PROJECT_DIR}/explainable-platform/"
echo

# ---------- 1. Upload only the frontend folder ----------
# --delete keeps the remote tree in sync with the local one (drops stale files).
# We intentionally do NOT rsync the .env — production values live on the VM and
# the docker-compose.prod.yml `environment:` block overrides them anyway.
echo "==> [1/3] rsync frontend to VM"
rsync -avz --delete \
    --exclude '.next' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude '.env.local' \
    "${MAC_REPO_DIR}/explainable-platform/" \
    "${VM_SSH}:${VM_PROJECT_DIR}/explainable-platform/"

echo

# ---------- 2. Rebuild + force-recreate frontend container ----------
echo "==> [2/3] build + force-recreate frontend on VM"
ssh -t "${VM_SSH}" "
    set -e
    cd '${VM_PROJECT_DIR}'
    sudo docker compose -f docker-compose.prod.yml build frontend
    sudo docker compose -f docker-compose.prod.yml up -d --force-recreate frontend
    sleep 10
    echo
    echo '--- frontend logs (tail) ---'
    sudo docker logs frontend 2>&1 | tail -10
"

echo

# ---------- 3. Health check ----------
echo "==> [3/3] health check"
ssh -t "${VM_SSH}" '
    echo "=== [1] backend direct ===";   curl -sI http://127.0.0.1:3000/api || true
    echo
    echo "=== [2] frontend direct ===";  curl -sI http://127.0.0.1:3001/   || true
    echo
    echo "=== [3] nginx -> frontend ==="; curl -sI http://127.0.0.1/        || true
    echo
    echo "=== [4] nginx -> backend  ==="; curl -sI http://127.0.0.1/api     || true
'

echo
echo "Done. Hard-refresh http://35.239.175.89/developer/mlflow in the browser (Cmd+Shift+R)."
