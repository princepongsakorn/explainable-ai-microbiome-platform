#!/usr/bin/env bash
# Full deploy to VM #2 — backend + nginx + frontend, in that order.
#
# Use this when BOTH the NestJS service and the Next.js frontend have changed
# (e.g. the SSE + plot-regeneration work from the two recent feature chats).
# For a frontend-only change, deploy_frontend.sh is still the lighter option.
#
# What it does, in order:
#   1. rsync explainable-platform-service/  (backend source)  -> VM
#   2. rsync explainable-platform/          (frontend source) -> VM
#   3. copy docker-compose.prod.yml + deployment/nginx.conf   -> VM
#   4. build + force-recreate the `backend` container
#        - TypeORM `synchronize: true` auto-creates the new columns
#          (waterfallError / heatmapError / beeswarmError) on restart,
#          so no manual migration is needed.
#   5. apply nginx.conf and reload nginx
#        - REQUIRED for SSE: the new `location /api/events/` block turns
#          proxy buffering off. Without it, SSE responses are buffered and
#          the live updates never reach the browser.
#   6. build + force-recreate the `frontend` container
#        - `npm ci` inside the image picks up @microsoft/fetch-event-source.
#   7. 6-layer health check (incl. the SSE endpoint).
#
# Order rationale: backend must expose /api/events/* BEFORE nginx starts
# routing to it, and the frontend should be last so it never opens an SSE
# stream against a backend/nginx that isn't ready yet.
#
# Usage (from anywhere on the Mac):
#   bash ~/MasterProject/project/explainable-ai-microbiome-platform/deployment/deploy_all.sh
#
# Override the SSH target / paths if they change:
#   VM_SSH=print@new-host bash deploy_all.sh
#
# Requires: ssh + rsync on the Mac, the matching SSH key already loaded, and
# sudo rights for the `print` user on the VM (for nginx + docker).

set -euo pipefail

VM_SSH="${VM_SSH:-print@35.239.175.89}"
VM_PROJECT_DIR="${VM_PROJECT_DIR:-/home/print/explainable-ai-microbiome-platform}"
MAC_REPO_DIR="${MAC_REPO_DIR:-$HOME/MasterProject/project/explainable-ai-microbiome-platform}"
COMPOSE_FILE="docker-compose.prod.yml"

echo "==> Target VM : ${VM_SSH}"
echo "==> Remote dir: ${VM_PROJECT_DIR}"
echo "==> Mac repo  : ${MAC_REPO_DIR}"
echo

# ---------- 1. Upload backend source ----------
# --delete keeps the remote tree in sync (drops files removed on the Mac).
# .env lives on the VM and must NOT be overwritten; node_modules/dist are
# rebuilt inside the Docker image so there's no point shipping them.
echo "==> [1/7] rsync backend (explainable-platform-service) to VM"
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.env' \
    --exclude '.git' \
    "${MAC_REPO_DIR}/explainable-platform-service/" \
    "${VM_SSH}:${VM_PROJECT_DIR}/explainable-platform-service/"
echo

# ---------- 2. Upload frontend source ----------
echo "==> [2/7] rsync frontend (explainable-platform) to VM"
rsync -avz --delete \
    --exclude '.next' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude '.env.local' \
    "${MAC_REPO_DIR}/explainable-platform/" \
    "${VM_SSH}:${VM_PROJECT_DIR}/explainable-platform/"
echo

# ---------- 3. Upload compose file + nginx config ----------
# Single files, no --delete. nginx.conf is staged in /tmp and applied with
# sudo in step 5 (the print user can't write /etc/nginx directly via rsync).
echo "==> [3/7] copy ${COMPOSE_FILE} + nginx.conf to VM"
rsync -avz \
    "${MAC_REPO_DIR}/${COMPOSE_FILE}" \
    "${VM_SSH}:${VM_PROJECT_DIR}/${COMPOSE_FILE}"
rsync -avz \
    "${MAC_REPO_DIR}/deployment/nginx.conf" \
    "${VM_SSH}:/tmp/platform-nginx.conf"
echo

# ---------- 4. Build + recreate backend ----------
echo "==> [4/7] build + force-recreate backend on VM"
ssh -t "${VM_SSH}" "
    set -e
    cd '${VM_PROJECT_DIR}'
    sudo docker compose -f ${COMPOSE_FILE} build backend
    sudo docker compose -f ${COMPOSE_FILE} up -d --force-recreate backend
    sleep 8
    echo
    echo '--- backend logs (tail) ---'
    sudo docker logs backend 2>&1 | tail -15
"
echo

# ---------- 5. Apply nginx config ----------
# `nginx -t` first — set -e aborts the deploy if the config is invalid,
# so a bad nginx.conf can never take down the running reverse proxy.
echo "==> [5/7] apply nginx.conf + reload nginx"
ssh -t "${VM_SSH}" '
    set -e
    sudo cp /tmp/platform-nginx.conf /etc/nginx/sites-available/platform
    sudo nginx -t
    sudo systemctl reload nginx
    echo "nginx reloaded."
'
echo

# ---------- 6. Build + recreate frontend ----------
echo "==> [6/7] build + force-recreate frontend on VM"
ssh -t "${VM_SSH}" "
    set -e
    cd '${VM_PROJECT_DIR}'
    sudo docker compose -f ${COMPOSE_FILE} build frontend
    sudo docker compose -f ${COMPOSE_FILE} up -d --force-recreate frontend
    sleep 10
    echo
    echo '--- frontend logs (tail) ---'
    sudo docker logs frontend 2>&1 | tail -10
"
echo

# ---------- 7. Health check ----------
# Layers 1-4 are the original checks. Layer 5 confirms the SSE route is
# wired end-to-end: a 401 is the SUCCESS case here — it means nginx routed
# the request and JwtAuthGuard rejected the missing token (route exists,
# backend up). A 404 means the route isn't registered; 502 means backend
# is down; a hang means nginx is still buffering (proxy_buffering not off).
echo "==> [7/7] health check"
ssh -t "${VM_SSH}" '
    echo "=== [1] backend direct        ==="; curl -sI  http://127.0.0.1:3000/api || true
    echo
    echo "=== [2] frontend direct       ==="; curl -sI  http://127.0.0.1:3001/    || true
    echo
    echo "=== [3] nginx -> frontend     ==="; curl -sI  http://127.0.0.1/         || true
    echo
    echo "=== [4] nginx -> backend      ==="; curl -sI  http://127.0.0.1/api      || true
    echo
    echo "=== [5] nginx -> SSE endpoint (expect HTTP 401) ==="
    curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 5 \
        http://127.0.0.1/api/events/predictions/healthcheck || true
'

echo
echo "Done. Hard-refresh http://35.239.175.89/ in the browser (Cmd+Shift+R)."
echo "Then open a prediction page and confirm /api/events/predictions/<id>"
echo "stays open as an event-stream in DevTools > Network."
