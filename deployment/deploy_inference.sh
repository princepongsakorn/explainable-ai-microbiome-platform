#!/usr/bin/env bash
# Deploy the inference service (Flask + SHAP) to VM #2.
#
# Use this whenever kserve-custom-runtime/ changes. The inference service runs as a Docker container managed by the
# systemd unit `inference.service`; that unit does `docker run <IMAGE>`, so a
# code change only takes effect once the image is rebuilt and the service is
# restarted.
#
# What it does:
#   1. rsync kserve-custom-runtime/  ->  VM
#   2. docker build the image ON the VM, reusing the same tag the systemd
#      unit references. Building on the VM is REQUIRED: the VM is amd64 and a
#      Mac (arm64) image would not run there.
#   3. systemctl restart inference.service  (its ExecStartPre stops/removes
#      the old container; `docker run --rm` then starts the fresh image).
#   4. wait for the health endpoint, print status + recent logs.
#   5. prune dangling images so the old build doesn't pile up on disk.
#
# This is NOT setup_inference.sh — that one is first-time setup (installs
# Docker, writes the systemd unit, seeds /etc/inference/inference.env). For a
# routine code update, this script is all you need.
#
# Usage (from anywhere on the Mac):
#   VM_SSH=<user>@<app-vm-host> bash deployment/deploy_inference.sh
#
# Override the SSH target / image tag if they change:
#   VM_SSH=<user>@<app-vm-host> IMAGE=myrepo/img:tag bash deploy_inference.sh
#
# Requires: ssh + rsync on the Mac, and sudo rights for the SSH user on the VM
# (for docker + systemctl). GitHub Actions runs this same script; see
# deployment/README-github-actions.md.

set -euo pipefail

VM_SSH="${VM_SSH:?set VM_SSH=<user>@<app-vm-host>}"
VM_HOST="${VM_SSH#*@}"
VM_PROJECT_DIR="${VM_PROJECT_DIR:-/home/${VM_SSH%@*}/explainable-ai-microbiome-platform}"
MAC_REPO_DIR="${MAC_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
IMAGE="${IMAGE:-pongsakornpongsutiyakorn/kserve-shap-model:latest}"
INFERENCE_PORT="${INFERENCE_PORT:-8080}"

RUNTIME_DIR="${VM_PROJECT_DIR}/kserve-custom-runtime"
# A terminal for sudo's password prompt when run by hand; none in CI, where the
# sudoers rule makes sudo passwordless.
SSH_TTY_FLAG=""
if [ -t 0 ]; then SSH_TTY_FLAG="-t"; fi

echo "==> Target VM : ${VM_SSH}"
echo "==> Runtime   : ${RUNTIME_DIR}"
echo "==> Image tag : ${IMAGE}"
echo

# ---------- 1. Upload the inference runtime ----------
# --delete keeps the remote tree in sync. __pycache__ / .DS_Store are local
# junk and must never reach the build context.
echo "==> [1/3] rsync kserve-custom-runtime to VM"
rsync -avz --delete \
    --exclude '__pycache__' \
    --exclude '.DS_Store' \
    --exclude '.pytest_cache' \
    "${MAC_REPO_DIR}/kserve-custom-runtime/" \
    "${VM_SSH}:${RUNTIME_DIR}/"
echo

# ---------- 2. Build + restart on the VM ----------
# Plain `docker build` (no --pull) so the cached torch / requirements layers
# are reused — a code-only change then rebuilds just the final COPY layer.
echo "==> [2/3] build image + restart inference.service on VM"
ssh ${SSH_TTY_FLAG} "${VM_SSH}" "
    set -e
    cd '${RUNTIME_DIR}'
    echo '--- docker build ---'
    sudo docker build -t '${IMAGE}' .
    echo
    echo '--- restart service ---'
    sudo systemctl restart inference.service
    echo 'inference.service restarted.'
    echo
    echo '--- pruning dangling images ---'
    sudo docker image prune -f
"
echo

# ---------- 3. Health check ----------
# The unit loads the model + SHAP on startup, so allow a generous window.
echo "==> [3/3] health check"
ssh ${SSH_TTY_FLAG} "${VM_SSH}" "
    READY=0
    for i in \$(seq 1 40); do
        if curl -sf 'http://127.0.0.1:${INFERENCE_PORT}/v1/mlflow/tracking_uri' >/dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 3
    done
    echo
    echo '=== systemctl status ==='
    sudo systemctl status inference --no-pager | head -12 || true
    echo
    echo '=== /v1/mlflow/tracking_uri ==='
    curl -s 'http://127.0.0.1:${INFERENCE_PORT}/v1/mlflow/tracking_uri' || true
    echo
    echo
    if [ \"\$READY\" -ne 1 ]; then
        echo '!! Service did not become ready — recent logs:'
        sudo journalctl -u inference -n 60 --no-pager
        exit 1
    fi
    echo 'Inference service is READY.'
"

echo
echo "Done."
