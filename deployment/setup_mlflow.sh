#!/bin/bash
#
# MLflow Tracking Server setup with built-in basic auth
# Target: Ubuntu 22.04 LTS, same VM as PostgreSQL
# Prereq : setup_postgresql.sh has already been run successfully
#          (reads credentials from /root/mlflow_db_credentials.txt)
#
# Usage:
#   scp setup_mlflow.sh print@34.57.22.206:~
#   ssh print@34.57.22.206
#   chmod +x setup_mlflow.sh
#   sudo ./setup_mlflow.sh
#
# Optional env overrides:
#   MLFLOW_ADMIN_PASSWORD    (default: auto-generated 32-char)
#   MLFLOW_PORT              (default: 5000)
#   GCS_BUCKET               (default: gs://microbiome_xai_platform)
#   ARTIFACT_PREFIX          (default: mlflow-artifacts)

set -euo pipefail

# ---------- Config ----------
MLFLOW_SYS_USER="mlflow"
MLFLOW_HOME="/opt/mlflow"
VENV_DIR="${MLFLOW_HOME}/venv"
AUTH_CONFIG="${MLFLOW_HOME}/basic_auth.ini"
AUTH_DB="${MLFLOW_HOME}/basic_auth.db"

GCS_BUCKET="${GCS_BUCKET:-gs://microbiome_xai_platform}"
ARTIFACT_PREFIX="${ARTIFACT_PREFIX:-mlflow-artifacts}"
ARTIFACT_ROOT="${GCS_BUCKET}/${ARTIFACT_PREFIX}"

MLFLOW_PORT="${MLFLOW_PORT:-5000}"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="${MLFLOW_ADMIN_PASSWORD:-$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)}"

DB_CREDS_FILE="/root/mlflow_db_credentials.txt"
CREDS_FILE="/root/mlflow_credentials.txt"

EXPECTED_SA="1066155824755-compute@developer.gserviceaccount.com"

log() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

# ---------- Load DB credentials ----------
if [[ ! -f "${DB_CREDS_FILE}" ]]; then
  echo "ERROR: ${DB_CREDS_FILE} not found. Run setup_postgresql.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${DB_CREDS_FILE}"
: "${DB_HOST:?missing}" "${DB_PORT:?missing}" "${DB_NAME:?missing}" "${DB_USER:?missing}" "${DB_PASSWORD:?missing}"

# ---------- Idempotency: reuse existing admin password + secret key if present ----------
FRESH_INSTALL=1
FLASK_SECRET_KEY="$(openssl rand -hex 32)"
if [[ -f "${AUTH_DB}" && -f "${CREDS_FILE}" ]]; then
  log "Existing MLflow auth DB detected - reusing credentials from ${CREDS_FILE}"
  EXISTING_PW=$(grep '^MLFLOW_ADMIN_PASSWORD=' "${CREDS_FILE}" | cut -d= -f2-)
  EXISTING_SK=$(grep '^MLFLOW_FLASK_SERVER_SECRET_KEY=' "${CREDS_FILE}" | cut -d= -f2-)
  if [[ -n "${EXISTING_PW}" ]]; then
    ADMIN_PASSWORD="${EXISTING_PW}"
    FRESH_INSTALL=0
  fi
  if [[ -n "${EXISTING_SK}" ]]; then
    FLASK_SECRET_KEY="${EXISTING_SK}"
  fi
fi

# ---------- Install system dependencies ----------
log "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  python3 python3-venv python3-pip \
  build-essential libpq-dev curl jq

# ---------- Verify VM service account matches expectation ----------
log "Checking VM service account..."
ACTUAL_SA=$(curl -sf -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email || true)
if [[ -n "${ACTUAL_SA}" ]]; then
  log "VM service account: ${ACTUAL_SA}"
  if [[ "${ACTUAL_SA}" != "${EXPECTED_SA}" ]]; then
    log "WARNING: VM SA differs from expected (${EXPECTED_SA})."
  fi

  ACTUAL_SCOPES=$(curl -sf -H "Metadata-Flavor: Google" \
    http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/scopes || true)
  if ! echo "${ACTUAL_SCOPES}" | grep -qE "(cloud-platform|devstorage.(read_write|full_control))"; then
    log "WARNING: VM OAuth scopes may be insufficient for GCS. Current scopes:"
    echo "${ACTUAL_SCOPES}"
    log "If GCS writes fail, stop the VM and update access scopes to 'cloud-platform'."
  fi
else
  log "WARNING: not running on GCE metadata server? Skipping SA check."
fi

# ---------- Create mlflow system user ----------
if ! id -u "${MLFLOW_SYS_USER}" >/dev/null 2>&1; then
  log "Creating system user ${MLFLOW_SYS_USER}..."
  useradd --system --home-dir "${MLFLOW_HOME}" --create-home --shell /usr/sbin/nologin "${MLFLOW_SYS_USER}"
else
  mkdir -p "${MLFLOW_HOME}"
fi

# ---------- Python venv + install MLflow ----------
log "Creating Python virtualenv at ${VENV_DIR}..."
if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

log "Installing mlflow[auth], psycopg2, google-cloud-storage..."
"${VENV_DIR}/bin/pip" install --upgrade pip -q
# mlflow[auth] pulls in Flask-WTF (required by --app-name basic-auth)
# IMPORTANT: pin google-auth and google-cloud-storage to avoid HTTPS metadata bug.
#   - google-auth >= 2.30 has a "trust boundary" code path that hits
#     https://metadata.google.internal:443 (no valid TLS cert) instead of HTTP
#     → SSLCertVerificationError → every artifact upload returns 500.
#   - google-cloud-storage >= 3.0 refactored its credential refresh flow,
#     which exposes the same bug.
# Pinning both to the 2.x line keeps the HTTP-only metadata flow that works on GCE.
"${VENV_DIR}/bin/pip" install -q \
  "mlflow[auth]>=2.9.0,<3" \
  psycopg2-binary \
  "google-auth>=2.20,<2.30" \
  "google-cloud-storage>=2.10,<3.0"

chown -R "${MLFLOW_SYS_USER}:${MLFLOW_SYS_USER}" "${MLFLOW_HOME}"

# ---------- Write basic_auth.ini ----------
# NOTE: admin_password is only consumed on first auth-DB creation.
# On re-runs, the existing password in basic_auth.db takes precedence.
log "Writing MLflow basic auth config to ${AUTH_CONFIG}..."
cat > "${AUTH_CONFIG}" <<INI
[mlflow]
default_permission = READ
database_uri = sqlite:///${AUTH_DB}
admin_username = ${ADMIN_USERNAME}
admin_password = ${ADMIN_PASSWORD}
authorization_function = mlflow.server.auth:authenticate_request_basic_auth
INI
chown "${MLFLOW_SYS_USER}:${MLFLOW_SYS_USER}" "${AUTH_CONFIG}"
chmod 600 "${AUTH_CONFIG}"

# ---------- systemd service ----------
log "Writing systemd unit /etc/systemd/system/mlflow.service..."
cat > /etc/systemd/system/mlflow.service <<SERVICE
[Unit]
Description=MLflow Tracking Server (with basic auth)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${MLFLOW_SYS_USER}
Group=${MLFLOW_SYS_USER}
WorkingDirectory=${MLFLOW_HOME}
Environment="MLFLOW_AUTH_CONFIG_PATH=${AUTH_CONFIG}"
Environment="MLFLOW_FLASK_SERVER_SECRET_KEY=${FLASK_SECRET_KEY}"
Environment="HOME=${MLFLOW_HOME}"
ExecStart=${VENV_DIR}/bin/mlflow server \\
  --backend-store-uri postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME} \\
  --artifacts-destination ${ARTIFACT_ROOT} \\
  --host 0.0.0.0 \\
  --port ${MLFLOW_PORT} \\
  --app-name basic-auth \\
  --workers 2
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${MLFLOW_HOME}

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable mlflow
systemctl restart mlflow

# ---------- Wait for server to be ready ----------
log "Waiting for MLflow to respond on http://localhost:${MLFLOW_PORT}..."
READY=0
for i in {1..60}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${ADMIN_USERNAME}:${ADMIN_PASSWORD}" \
    "http://localhost:${MLFLOW_PORT}/api/2.0/mlflow/experiments/search?max_results=1" || true)
  if [[ "${HTTP_CODE}" == "200" ]]; then
    READY=1
    break
  fi
  sleep 2
done

if [[ ${READY} -ne 1 ]]; then
  echo "ERROR: MLflow did not become ready. Check: journalctl -u mlflow -n 200 --no-pager" >&2
  exit 1
fi
log "MLflow is up and auth works."

# ---------- Smoke test: write/read to GCS via proxy ----------
log "Smoke-testing artifact upload to ${ARTIFACT_ROOT} via proxy..."
SMOKE_DIR=$(mktemp -d)
trap 'rm -rf "${SMOKE_DIR}"' EXIT

"${VENV_DIR}/bin/python" - <<PY
import os, mlflow
os.environ["MLFLOW_TRACKING_USERNAME"] = "${ADMIN_USERNAME}"
os.environ["MLFLOW_TRACKING_PASSWORD"] = "${ADMIN_PASSWORD}"
mlflow.set_tracking_uri("http://localhost:${MLFLOW_PORT}")
exp = mlflow.set_experiment("_smoke_test")
with mlflow.start_run(run_name="setup-verify") as run:
    mlflow.log_param("p", 1)
    mlflow.log_metric("m", 0.99)
    p = "${SMOKE_DIR}/hello.txt"
    open(p, "w").write("hello from setup_mlflow.sh")
    mlflow.log_artifact(p)
print("OK - run_id:", run.info.run_id, "artifact_uri:", run.info.artifact_uri)
PY

# ---------- Save credentials ----------
umask 077
cat > "${CREDS_FILE}" <<EOF
# MLflow server credentials - generated $(date -Iseconds)
MLFLOW_HOST=$(curl -sf -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || echo "<VM_PUBLIC_IP>")
MLFLOW_PORT=${MLFLOW_PORT}
MLFLOW_ADMIN_USERNAME=${ADMIN_USERNAME}
MLFLOW_ADMIN_PASSWORD=${ADMIN_PASSWORD}
MLFLOW_FLASK_SERVER_SECRET_KEY=${FLASK_SECRET_KEY}

# Tracking URI template (replace host if needed):
MLFLOW_TRACKING_URI=http://\$MLFLOW_HOST:${MLFLOW_PORT}

# Artifact store
MLFLOW_ARTIFACT_ROOT=${ARTIFACT_ROOT}
EOF

# ---------- Report ----------
EXT_IP=$(curl -sf -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || echo "<VM_PUBLIC_IP>")

echo
echo "================================================================"
echo " MLflow Tracking Server setup complete"
echo "----------------------------------------------------------------"
echo "  URL             : http://${EXT_IP}:${MLFLOW_PORT}"
echo "  Admin user      : ${ADMIN_USERNAME}"
echo "  Admin password  : ${ADMIN_PASSWORD}"
echo "  Backend store   : postgresql://${DB_USER}:<pwd>@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "  Artifact store  : ${ARTIFACT_ROOT} (via proxy)"
echo "  Auth DB (SQLite): ${AUTH_DB}"
echo
echo "  Credentials saved to: ${CREDS_FILE} (root-readable only)"
echo
echo "  Check service : sudo systemctl status mlflow"
echo "  Tail logs     : sudo journalctl -u mlflow -f"
echo "================================================================"
echo
echo " REMAINING MANUAL STEPS:"
echo "  1. Open GCP firewall for port ${MLFLOW_PORT} (scope to your IP):"
echo "       gcloud compute firewall-rules create allow-mlflow-${MLFLOW_PORT} \\"
echo "         --network=default --direction=INGRESS \\"
echo "         --action=ALLOW --rules=tcp:${MLFLOW_PORT} \\"
echo "         --source-ranges=<YOUR_IP>/32"
echo
echo "  2. Grant bucket access to the VM's service account (one-time):"
echo "       gcloud storage buckets add-iam-policy-binding ${GCS_BUCKET} \\"
echo "         --member=serviceAccount:${EXPECTED_SA} \\"
echo "         --role=roles/storage.objectAdmin"
echo
echo "  3. (Recommended) Put nginx + HTTPS in front before exposing publicly."
echo "     MLflow basic auth sends credentials in plaintext over HTTP."
echo "================================================================"
