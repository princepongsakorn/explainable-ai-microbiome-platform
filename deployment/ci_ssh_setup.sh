#!/usr/bin/env bash
# GitHub Actions only: give the deploy scripts an SSH key in place of a password.
#
# Reads VM_HOST, VM_USER, VM_SSH_KEY and VM_KNOWN_HOSTS from the environment
# (repository secrets) and exports VM_SSH for the steps that follow.
set -euo pipefail

: "${VM_HOST:?}" "${VM_USER:?}" "${VM_SSH_KEY:?}" "${VM_KNOWN_HOSTS:?}"

install -d -m 700 ~/.ssh
printf '%s\n' "$VM_SSH_KEY" > ~/.ssh/deploy_key
chmod 600 ~/.ssh/deploy_key
# Pinned host key: a VM that answers with a different key is refused.
printf '%s\n' "$VM_KNOWN_HOSTS" > ~/.ssh/known_hosts
cat > ~/.ssh/config <<CONFIG
Host ${VM_HOST}
  User ${VM_USER}
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  BatchMode yes
CONFIG
chmod 600 ~/.ssh/config

echo "VM_SSH=${VM_USER}@${VM_HOST}" >> "$GITHUB_ENV"
