#!/bin/bash
#
# Inference Service (Flask + SHAP) setup
# Target: Ubuntu 22.04 LTS on GCP Compute Engine
# Deploys pongsakornpongsutiyakorn/kserve-shap-model as a Docker container under systemd
#
# Usage:
#   1. SCP this file to the VM:
#        scp setup_inference.sh print@35.239.175.89:~
#   2. SSH in and run (supply MLflow creds via env):
#        ssh print@35.239.175.89
#        chmod +x setup_inference.sh
#        sudo MLFLOW_URL=http://35.225.129.127:5000 \
#             MLFLOW_TRACKING_USERNAME=admin \
#             MLFLOW_TRACKING_PASSWORD='<password>' \
#             ./setup_inference.sh
#
# Optional env overrides:
#   INFERENCE_PORT  (default: 8080)
#   IMAGE           (default: pongsakornpongsutiyakorn/kserve-shap-model:latest)
#   CONTAINER_NAME  (default: inference)
#   CACHE_DIR       (default: /var/lib/inference/cache)

set -euo pipefail

# ---------- Config ----------
MLFLOW_URL="${MLFLOW_URL:?MLFLOW_URL is required, e.g. http://35.225.129.127:5000}"
MLFLOW_TRACKING_USERNAME="${MLFLOW_TRACKING_USERNAME:?MLFLOW_TRACKING_USERNAME is required}"
MLFLOW_TRACKING_PASSWORD="${MLFLOW_TRACKING_PASSWORD:?MLFLOW_TRACKING_PASSWORD is required}"

INFERENCE_PORT="${INFERENCE_PORT:-8080}"
IMAGE="${IMAGE:-pongsakornpongsutiyakorn/kserve-shap-model:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-inference}"
CACHE_DIR="${CACHE_DIR:-/var/lib/inference/cache}"

CREDS_FILE="/root/inference_credentials.txt"
SERVICE_FILE="/etc/systemd/system/inference.service"

log() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)." >&2
  exit 1
fi

# ---------- Install Docker Engine (official repo, Debian/Ubuntu auto-detect) ----------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine from official repo..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release

  # Detect distro (debian or ubuntu)
  OS_ID="$(. /etc/os-release && echo "${ID}")"
  OS_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  if [[ "${OS_ID}" != "debian" && "${OS_ID}" != "ubuntu" ]]; then
    echo "Unsupported OS: ${OS_ID}. Expected debian or ubuntu." >&2
    exit 1
  fi
  log "Detected OS: ${OS_ID} ${OS_CODENAME}"

  install -m 0755 -d /etc/apt/keyrings

  # Re-fetch key (force overwrite in case previous run used wrong distro)
  rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} ${OS_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
else
  log "Docker already installed: $(docker --version)"
fi

# ---------- Pull image ----------
log "Pulling ${IMAGE}..."
docker pull "${IMAGE}"

# ---------- Prepare cache directory (host-mounted) ----------
log "Preparing cache directory at ${CACHE_DIR}..."
mkdir -p "${CACHE_DIR}"
# Flask container runs as root inside; wide perms safe since it's a dedicated host dir
chmod 755 "${CACHE_DIR}"

# ---------- Write EnvironmentFile (keeps creds out of unit file) ----------
ENV_FILE="/etc/inference/inference.env"
log "Writing ${ENV_FILE}..."
install -d -m 0750 /etc/inference
umask 077
cat > "${ENV_FILE}" <<EOF
MLFLOW_URL=${MLFLOW_URL}
MLFLOW_TRACKING_USERNAME=${MLFLOW_TRACKING_USERNAME}
MLFLOW_TRACKING_PASSWORD=${MLFLOW_TRACKING_PASSWORD}
EOF
chmod 600 "${ENV_FILE}"

# ---------- systemd unit ----------
log "Writing ${SERVICE_FILE}..."
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Explainable AI Inference Service (Flask + SHAP)
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Restart=always
RestartSec=10
EnvironmentFile=${ENV_FILE}

# Clean up any stale container from previous run
ExecStartPre=-/usr/bin/docker stop ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker rm ${CONTAINER_NAME}

ExecStart=/usr/bin/docker run --rm \\
  --name ${CONTAINER_NAME} \\
  -p ${INFERENCE_PORT}:8080 \\
  -e MLFLOW_URL \\
  -e MLFLOW_TRACKING_USERNAME \\
  -e MLFLOW_TRACKING_PASSWORD \\
  -v ${CACHE_DIR}:/tmp/cache \\
  --log-driver=journald \\
  ${IMAGE}

ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable inference.service
log "Restarting inference.service..."
systemctl restart inference.service

# ---------- Wait until ready ----------
log "Waiting for inference service to become ready on port ${INFERENCE_PORT}..."
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${INFERENCE_PORT}/v1/mlflow/tracking_uri" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [[ $READY -ne 1 ]]; then
  echo "ERROR: Inference service did not become ready."
  echo "Check logs with:"
  echo "  sudo journalctl -u inference -n 200 --no-pager"
  echo "  sudo docker logs ${CONTAINER_NAME} 2>&1 | tail -100"
  exit 1
fi
log "Inference service is READY."

# ---------- Verify ----------
log "Verifying /v1/mlflow/tracking_uri..."
curl -s "http://127.0.0.1:${INFERENCE_PORT}/v1/mlflow/tracking_uri"
echo

# ---------- Persist metadata ----------
cat > "${CREDS_FILE}" <<EOF
# Inference Service metadata - generated $(date -Iseconds)
INFERENCE_INTERNAL_URL=http://127.0.0.1:${INFERENCE_PORT}
INFERENCE_PUBLIC_URL=http://\$(hostname -I | awk '{print \$1}'):${INFERENCE_PORT}

IMAGE=${IMAGE}
CONTAINER=${CONTAINER_NAME}
CACHE_DIR=${CACHE_DIR}
ENV_FILE=${ENV_FILE}

# Upstream MLflow:
MLFLOW_URL=${MLFLOW_URL}
MLFLOW_TRACKING_USERNAME=${MLFLOW_TRACKING_USERNAME}
EOF
chmod 600 "${CREDS_FILE}"

echo
echo "================================================================"
echo " Inference Service setup complete"
echo "----------------------------------------------------------------"
echo "  Image         : ${IMAGE}"
echo "  Container     : ${CONTAINER_NAME}"
echo "  Port          : ${INFERENCE_PORT}"
echo "  Cache dir     : ${CACHE_DIR}"
echo "  Env file      : ${ENV_FILE} (root-only)"
echo "  Creds file    : ${CREDS_FILE} (root-only)"
echo
echo "  Upstream MLflow: ${MLFLOW_URL}"
echo
echo "  Health:"
echo "    curl http://127.0.0.1:${INFERENCE_PORT}/v1/mlflow/tracking_uri"
echo
echo "  Service control:"
echo "    sudo systemctl status inference"
echo "    sudo journalctl -u inference -f"
echo "    sudo docker logs ${CONTAINER_NAME}"
echo
echo "  NOTE: Open GCP firewall port ${INFERENCE_PORT} only to VM #1's"
echo "        internal IP (not 0.0.0.0/0) once backend is deployed."
echo "================================================================"
