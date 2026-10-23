# Deploying with GitHub Actions

`.github/workflows/deploy.yml` deploys the application VM on every push to `main`. It deploys only the parts a push changed:

| Changed | Tests first | Then |
|---|---|---|
| `kserve-custom-runtime/` | pytest | `deployment/deploy_inference.sh` |
| `explainable-platform-service/`, `explainable-platform/`, `docker-compose.prod.yml`, `deployment/nginx.conf` | tsc + jest (Control Plane) | `deployment/deploy_all.sh` |

A failing test stops that part's deploy. When both parts changed, the Inference Service goes first. **Actions → Deploy to VM → Run workflow** deploys `all`, `inference` or `app` by hand, for example to redeploy without a code change.

The workflow runs the same scripts you run from a laptop. The only difference is that it logs in with an SSH key instead of a password.

## One-time setup

### 1. A deploy key

On the laptop, create a key used only by GitHub Actions:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/.ssh/xaiserve_deploy
```

Authorize it on the VM (asks for the VM password once):

```bash
ssh-copy-id -i ~/.ssh/xaiserve_deploy.pub <user>@<app-vm-host>
```

### 2. Passwordless sudo for the deploy commands

The scripts run `sudo` on the VM, and there is nobody to type a password in Actions. On the VM, first check the paths:

```bash
command -v docker systemctl journalctl nginx cp
```

Expected: `/usr/bin/docker`, `/usr/bin/systemctl`, `/usr/bin/journalctl`, `/usr/sbin/nginx`, `/usr/bin/cp`. If any path differs, change it below. Then write the rule, check it, and install it:

```bash
cat > /tmp/github-deploy <<'EOF'
# Commands run by .github/workflows/deploy.yml (deploy_inference.sh, deploy_all.sh).
<user> ALL=(root) NOPASSWD: /usr/bin/docker, \
    /usr/bin/systemctl restart inference.service, \
    /usr/bin/systemctl status inference --no-pager, \
    /usr/bin/systemctl reload nginx, \
    /usr/bin/journalctl -u inference -n 60 --no-pager, \
    /usr/sbin/nginx -t, \
    /usr/bin/cp /tmp/platform-nginx.conf /etc/nginx/sites-available/platform
EOF
sudo visudo -cf /tmp/github-deploy && sudo install -m 440 -o root -g root /tmp/github-deploy /etc/sudoers.d/github-deploy
```

Other commands still ask for the password as before.

**`sudo docker` without a password is as powerful as root.** Anyone holding the deploy key controls the VM. The private key therefore lives only in the repository secret and on the laptop that created it.

### 3. Repository secrets

**Settings → Secrets and variables → Actions → New repository secret**, or with `gh` from the repository:

| Secret | Value |
|---|---|
| `VM_HOST` | `<app-vm-host>` |
| `VM_USER` | the SSH user on the VM |
| `VM_SSH_KEY` | the whole private key file `~/.ssh/xaiserve_deploy`, from `-----BEGIN` to `END … KEY-----` |
| `VM_KNOWN_HOSTS` | the VM's host key line from your `known_hosts` |

```bash
gh secret set VM_HOST --body <app-vm-host>
gh secret set VM_USER --body <user>
gh secret set VM_SSH_KEY < ~/.ssh/xaiserve_deploy
ssh-keygen -F <app-vm-host> | grep -v '^#' | gh secret set VM_KNOWN_HOSTS
```

`VM_KNOWN_HOSTS` pins the host key. If the VM is ever rebuilt and gets a new key, the deploy fails rather than connecting to an unknown machine. Update the secret after checking the new fingerprint.

### 4. Check it

Run **Deploy to VM** by hand with `inference`, then open the run's log. The last step should end with `Inference service is READY.`

## When it fails

- **`Permission denied (publickey)`:** the key is not in `~<user>/.ssh/authorized_keys`, or `VM_SSH_KEY` does not hold the whole file.
- **`Host key verification failed`:** `VM_KNOWN_HOSTS` does not match the VM.
- **`sudo: a password is required`:** a command is missing from `/etc/sudoers.d/github-deploy`, or its path or arguments differ.
