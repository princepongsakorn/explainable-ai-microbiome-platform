#!/usr/bin/env bash
# One-time setup: let GitHub Actions (.github/workflows/deploy.yml) deploy to
# your application VM. Run it on your own machine, from your clone.
#
#   bash deployment/setup_github_deploy.sh <user>@<app-vm-host> [web-ui-url]
#
# It does, in order:
#   1. creates a deploy key ~/.ssh/xaiserve_deploy (kept if it exists)
#   2. authorizes it on the VM               (asks for the VM password once)
#   3. installs the sudoers rule for the deploy commands
#                                             (asks for the sudo password once)
#   4. checks the key logs in and sudo needs no password for them
#   5. sets the repository variables DEPLOY_HOST, DEPLOY_USER (and DEPLOY_URL)
#      and the secrets DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS with the gh CLI
#
# The private key goes from the file straight to `gh secret set`; it is never
# printed. Needs: ssh, ssh-copy-id, gh (logged in, with access to the repo).
# Details and the manual steps: deployment/README-github-actions.md.
set -euo pipefail

TARGET="${1:?usage: bash deployment/setup_github_deploy.sh <user>@<app-vm-host> [web-ui-url]}"
WEB_URL="${2:-}"
VM_USER="${TARGET%@*}"
VM_HOST="${TARGET#*@}"
[ "$VM_USER" != "$TARGET" ] && [ -n "$VM_USER" ] && [ -n "$VM_HOST" ] \
    || { echo "Give the VM as <user>@<host>." >&2; exit 1; }
KEY="${DEPLOY_KEY_FILE:-$HOME/.ssh/xaiserve_deploy}"

step() { printf '\n==> %s\n' "$*"; }

# ---------- 0. Preconditions ----------
for cmd in ssh ssh-keygen ssh-copy-id gh; do
    command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Log in first: gh auth login" >&2; exit 1; }
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

# The host key must already be in known_hosts from a login you made yourself;
# this script will not trust a key it is seeing for the first time.
KNOWN="$(ssh-keygen -F "$VM_HOST" 2>/dev/null | grep -v '^#' || true)"
if [ -z "$KNOWN" ]; then
    echo "No host key for $VM_HOST in ~/.ssh/known_hosts." >&2
    echo "Log in once by hand (ssh $TARGET), check the fingerprint, then run this again." >&2
    exit 1
fi

echo "Repository : $REPO"
echo "VM         : $TARGET"
echo "Deploy key : $KEY"
echo "Host key   :"
ssh-keygen -F "$VM_HOST" -l 2>/dev/null | grep -v '^#' | sed 's/^/  /'
printf 'Continue? [y/N] '
read -r answer
[ "$answer" = y ] || [ "$answer" = Y ] || exit 1

# ---------- 1. Deploy key ----------
step "1/5 deploy key"
if [ -f "$KEY" ]; then
    echo "Using the existing $KEY"
else
    ssh-keygen -t ed25519 -N "" -C "github-actions-deploy ($REPO)" -f "$KEY"
fi

# ---------- 2. Authorize it on the VM ----------
step "2/5 authorize the key on the VM (VM password, if asked)"
ssh-copy-id -i "${KEY}.pub" "$TARGET"

# From here on, log in with the deploy key only, as Actions will.
vm() { ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$TARGET" "$@"; }
vm true || { echo "The deploy key does not log in." >&2; exit 1; }

# ---------- 3. sudoers rule ----------
step "3/5 sudoers rule for the deploy commands (sudo password, if asked)"
read -r DOCKER SYSTEMCTL JOURNALCTL NGINX CP < <(
    vm 'PATH=$PATH:/usr/sbin:/sbin; echo $(command -v docker systemctl journalctl nginx cp)'
)
[ -n "$CP" ] || { echo "Could not find docker, systemctl, journalctl, nginx and cp on the VM." >&2; exit 1; }
RULE="# Commands run by deploy_inference.sh and deploy_all.sh from GitHub Actions ($REPO).
${VM_USER} ALL=(root) NOPASSWD: ${DOCKER}, \\
    ${SYSTEMCTL} restart inference.service, \\
    ${SYSTEMCTL} status inference --no-pager, \\
    ${SYSTEMCTL} reload nginx, \\
    ${JOURNALCTL} -u inference -n 60 --no-pager, \\
    ${NGINX} -t, \\
    ${CP} /tmp/platform-nginx.conf /etc/nginx/sites-available/platform"
echo "$RULE"
RULE_B64="$(printf '%s\n' "$RULE" | base64 | tr -d '\n')"
# -t so sudo can ask for the password. visudo checks the rule before it is
# installed; a broken file in sudoers.d would lock sudo out.
ssh -t -i "$KEY" -o IdentitiesOnly=yes "$TARGET" "
    set -e
    tmp=\$(mktemp)
    echo '$RULE_B64' | base64 -d > \"\$tmp\"
    sudo visudo -cf \"\$tmp\"
    sudo install -m 440 -o root -g root \"\$tmp\" /etc/sudoers.d/xaiserve-deploy
    rm -f \"\$tmp\"
    sudo -k
"

# ---------- 4. Check ----------
step "4/5 check: key login and passwordless sudo"
# One quoted string: ssh joins its arguments, which would split the format.
version="$(vm "sudo -n docker version --format '{{.Server.Version}}'")" \
    || { echo "sudo still asks for a password." >&2; exit 1; }
echo "docker ${version} through sudo -n: ok"

# ---------- 5. Repository settings ----------
step "5/5 repository variables and secrets on $REPO"
gh variable set DEPLOY_HOST --repo "$REPO" --body "$VM_HOST"
gh variable set DEPLOY_USER --repo "$REPO" --body "$VM_USER"
if [ -n "$WEB_URL" ]; then
    gh variable set DEPLOY_URL --repo "$REPO" --body "$WEB_URL"
fi
gh secret set DEPLOY_SSH_KEY --repo "$REPO" < "$KEY"
printf '%s\n' "$KNOWN" | gh secret set DEPLOY_KNOWN_HOSTS --repo "$REPO"

echo
echo "Done. Deploys to $TARGET are on: every push to main deploys what changed."
echo "To deploy now: gh workflow run deploy.yml --repo $REPO -f target=all"
echo "The private key is still at $KEY; delete it if you will not need it again."
