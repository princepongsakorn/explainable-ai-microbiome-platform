#!/usr/bin/env bash
# GitHub Actions only: let the deploy scripts reach the VM with a key instead
# of a password, then hand them their settings.
#
# Required (repository variables / secrets):
#   DEPLOY_HOST, DEPLOY_USER       variables
#   DEPLOY_SSH_KEY                 secret: private key authorized on the VM
#   DEPLOY_KNOWN_HOSTS             secret: the VM's host key line(s)
# Optional variables, passed on to the deploy scripts when set:
#   DEPLOY_PATH      -> VM_PROJECT_DIR (default /home/<user>/explainable-ai-microbiome-platform)
#   INFERENCE_IMAGE  -> IMAGE (must match the image setup_inference.sh used)
set -euo pipefail

missing=()
for name in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS; do
    [ -n "${!name:-}" ] || missing+=("$name")
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "::error title=Deploy settings missing::${missing[*]} not set. See deployment/README-github-actions.md."
    exit 1
fi

install -d -m 700 ~/.ssh
printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy_key
chmod 600 ~/.ssh/deploy_key
# Pinned host key: a VM that answers with a different key is refused.
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts
cat > ~/.ssh/config <<CONFIG
Host ${DEPLOY_HOST}
  User ${DEPLOY_USER}
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 20
  ServerAliveInterval 30
CONFIG
chmod 600 ~/.ssh/config

# Fail here, with a clear message, rather than halfway through an rsync.
if ! ssh "${DEPLOY_HOST}" true; then
    echo "::error title=SSH failed::Could not log in as ${DEPLOY_USER}@${DEPLOY_HOST}. See 'When it fails' in deployment/README-github-actions.md."
    exit 1
fi
if ! ssh "${DEPLOY_HOST}" sudo -n docker version >/dev/null; then
    echo "::error title=sudo needs a password::The deploy commands must run with sudo -n. Install the sudoers rule from deployment/README-github-actions.md."
    exit 1
fi

{
    echo "VM_SSH=${DEPLOY_USER}@${DEPLOY_HOST}"
    if [ -n "${DEPLOY_PATH:-}" ]; then echo "VM_PROJECT_DIR=${DEPLOY_PATH}"; fi
    if [ -n "${INFERENCE_IMAGE:-}" ]; then echo "IMAGE=${INFERENCE_IMAGE}"; fi
} >> "$GITHUB_ENV"
echo "SSH to ${DEPLOY_USER}@${DEPLOY_HOST} works."
