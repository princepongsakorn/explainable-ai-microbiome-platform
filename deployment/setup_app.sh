#!/bin/bash
#
# Backend (NestJS) + Frontend (Next.js) deployment for VM #2
# Target: Debian 12 / Ubuntu 22.04 with Docker already installed
# (inference.service must already be running on port 8080)
#
# Prerequisites:
#   - Project source SCP'd to ${PROJECT_DIR} (default: ~/explainable-ai-microbiome-platform)
#   - VM compute SA has the following roles (one-time, via gcloud or Console):
#       roles/storage.objectAdmin                 on bucket gs://microbiome_xai_platform
#       roles/iam.serviceAccountTokenCreator      on itself (for V4 signed URLs)
#
# Usage:
#   chmod +x setup_app.sh
#   sudo ./setup_app.sh
#
# Optional env overrides:
#   PROJECT_DIR  (default: ~/explainable-ai-microbiome-platform on the user that ran sudo)
#   GCS_BUCKET   (default: microbiome_xai_platform)
#   PUBLIC_PORT  (default: 80)

set -euo pipefail

# ---------- Resolve invoking user (so ~ expands correctly under sudo) ----------
INVOKER="${SUDO_USER:-${USER}}"
INVOKER_HOME="$(eval echo "~${INVOKER}")"

PROJECT_DIR="${PROJECT_DIR:-${INVOKER_HOME}/explainable-ai-microbiome-platform}"
BACKEND_DIR="${PROJECT_DIR}/explainable-platform-service"
FRONTEND_DIR="${PROJECT_DIR}/explainable-platform"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"
NGINX_CONF_SRC="${PROJECT_DIR}/deployment/nginx.conf"

GCS_BUCKET="${GCS_BUCKET:-microbiome_xai_platform}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"

CREDS_FILE="/root/app_credentials.txt"

log() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# ---------- Sanity checks ----------
log "Checking project structure at ${PROJECT_DIR}..."
for d in "${BACKEND_DIR}" "${FRONTEND_DIR}"; do
  [[ -d "$d" ]] || { echo "Missing: $d" >&2; exit 1; }
done
[[ -f "${COMPOSE_FILE}" ]]    || { echo "Missing: ${COMPOSE_FILE}" >&2; exit 1; }
[[ -f "${NGINX_CONF_SRC}" ]]  || { echo "Missing: ${NGINX_CONF_SRC}" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not installed. Run setup_inference.sh first (it installs Docker)." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin not installed." >&2
  exit 1
fi

# ---------- Verify inference service is running on host:8080 ----------
if ! curl -sf "http://127.0.0.1:8080/v1/mlflow/tracking_uri" >/dev/null; then
  echo "WARNING: inference.service not responding on :8080. Backend will fail predictions." >&2
fi

# ---------- Verify VM compute SA scopes (cloud-platform required for GCS + signBlob) ----------
SA_EMAIL="$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email || true)"
SA_SCOPES="$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/scopes || true)"
log "VM service account: ${SA_EMAIL:-unknown}"
if ! echo "${SA_SCOPES}" | grep -q "cloud-platform"; then
  echo "WARNING: compute SA scope is not cloud-platform. Signed URLs + GCS writes will fail." >&2
fi

# ---------- Install nginx ----------
if ! command -v nginx >/dev/null 2>&1; then
  log "Installing nginx..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx
fi

# ---------- Backend .env (preserve existing if present; only fill missing) ----------
BACKEND_ENV="${BACKEND_DIR}/.env"
if [[ ! -f "${BACKEND_ENV}" ]]; then
  log "Creating ${BACKEND_ENV} from .env.example..."
  cp "${BACKEND_DIR}/.env.example" "${BACKEND_ENV}"
fi

# Generate JWT_SECRET if absent or placeholder
if grep -qE '^JWT_SECRET=replace-me' "${BACKEND_ENV}" 2>/dev/null \
   || ! grep -q '^JWT_SECRET=' "${BACKEND_ENV}"; then
  GENERATED_JWT="$(openssl rand -hex 32)"
  if grep -q '^JWT_SECRET=' "${BACKEND_ENV}"; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${GENERATED_JWT}|" "${BACKEND_ENV}"
  else
    echo "JWT_SECRET=${GENERATED_JWT}" >> "${BACKEND_ENV}"
  fi
  log "Generated new JWT_SECRET."
fi

# Ensure GCS_BUCKET is set
if ! grep -q '^GCS_BUCKET=' "${BACKEND_ENV}"; then
  echo "GCS_BUCKET=${GCS_BUCKET}" >> "${BACKEND_ENV}"
fi

# Ensure INFERENCE_SERVICE_URL points to host gateway (backend runs in container)
if grep -q '^INFERENCE_SERVICE_URL=' "${BACKEND_ENV}"; then
  sed -i "s|^INFERENCE_SERVICE_URL=.*|INFERENCE_SERVICE_URL=http://host.docker.internal:8080|" "${BACKEND_ENV}"
else
  echo "INFERENCE_SERVICE_URL=http://host.docker.internal:8080" >> "${BACKEND_ENV}"
fi

# DATABASE_URL must point to the postgres service in the compose network (not localhost)
if grep -q '^DATABASE_URL=' "${BACKEND_ENV}"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres_user:postgres_pass@postgres:5432/explainable_platform_db|" "${BACKEND_ENV}"
fi
if grep -q '^REDIS_HOST=' "${BACKEND_ENV}"; then
  sed -i "s|^REDIS_HOST=.*|REDIS_HOST=redis|" "${BACKEND_ENV}"
fi

# ---------- Frontend .env ----------
FRONTEND_ENV="${FRONTEND_DIR}/.env"
log "Writing ${FRONTEND_ENV}..."
cat > "${FRONTEND_ENV}" <<EOF
PORT=3001
# Frontend talks to backend through nginx — relative path means same origin.
API=/api
EOF

# ---------- Configure nginx ----------
log "Installing nginx site config..."
cp "${NGINX_CONF_SRC}" /etc/nginx/sites-available/platform
ln -sf /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/platform
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

# ---------- Build + start the stack ----------
log "Building backend + frontend images (5-15 min for first build)..."
cd "${PROJECT_DIR}"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# ---------- Wait for backend health ----------
log "Waiting for backend to respond on http://127.0.0.1:3000/api ..."
READY=0
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api" || true)
  # 404 is fine — means NestJS is up but no route at /api root
  if [[ "${CODE}" == "200" || "${CODE}" == "404" ]]; then
    READY=1
    break
  fi
  sleep 2
done
if [[ ${READY} -ne 1 ]]; then
  echo "WARNING: backend not ready after 120s. Check: docker compose logs backend" >&2
fi

log "Waiting for frontend on http://127.0.0.1:3001 ..."
READY=0
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3001" || true)
  if [[ "${CODE}" == "200" || "${CODE}" == "302" || "${CODE}" == "307" ]]; then
    READY=1
    break
  fi
  sleep 2
done
if [[ ${READY} -ne 1 ]]; then
  echo "WARNING: frontend not ready after 120s. Check: docker compose logs frontend" >&2
fi

# ---------- Save credentials ----------
EXT_IP="$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null \
  || hostname -I | awk '{print $1}')"

umask 077
cat > "${CREDS_FILE}" <<EOF
# Backend + Frontend deployment - generated $(date -Iseconds)
APP_URL=http://${EXT_IP}
APP_INTERNAL_BACKEND=http://127.0.0.1:3000
APP_INTERNAL_FRONTEND=http://127.0.0.1:3001
NGINX_PUBLIC_PORT=${PUBLIC_PORT}

GCS_BUCKET=${GCS_BUCKET}
GCS_PREDICTIONS_PREFIX=predictions

BACKEND_ENV=${BACKEND_ENV}
FRONTEND_ENV=${FRONTEND_ENV}
COMPOSE_FILE=${COMPOSE_FILE}
EOF

echo
echo "================================================================"
echo " App deployment complete"
echo "----------------------------------------------------------------"
echo "  Frontend URL : http://${EXT_IP}/"
echo "  Backend API  : http://${EXT_IP}/api/"
echo "  Inference    : http://127.0.0.1:8080  (host-only, not public)"
echo
echo "  Compose file : ${COMPOSE_FILE}"
echo "  Backend env  : ${BACKEND_ENV}"
echo "  Frontend env : ${FRONTEND_ENV}"
echo "  Creds saved  : ${CREDS_FILE}"
echo
echo "  Service control:"
echo "    docker compose -f ${COMPOSE_FILE} ps"
echo "    docker compose -f ${COMPOSE_FILE} logs -f backend"
echo "    sudo systemctl status nginx"
echo
echo " REMAINING MANUAL STEPS:"
echo "  1. Open GCP firewall for port ${PUBLIC_PORT} (your IP only):"
echo "       gcloud compute firewall-rules create allow-app-${PUBLIC_PORT} \\"
echo "         --network=default --direction=INGRESS \\"
echo "         --action=ALLOW --rules=tcp:${PUBLIC_PORT} \\"
echo "         --source-ranges=<YOUR_IP>/32"
echo
echo "  2. (One-time) Grant the compute SA permission to sign blobs (V4 signed URLs):"
echo "       gcloud iam service-accounts add-iam-policy-binding ${SA_EMAIL} \\"
echo "         --member=serviceAccount:${SA_EMAIL} \\"
echo "         --role=roles/iam.serviceAccountTokenCreator"
echo
echo "  3. (Recommended) Issue a TLS cert via certbot before going public:"
echo "       sudo apt install -y certbot python3-certbot-nginx"
echo "       sudo certbot --nginx -d <your-domain>"
echo "================================================================"
