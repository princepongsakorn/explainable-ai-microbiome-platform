# CI and automatic deploys

Two workflows ship with the repository:

| Workflow | Runs on | Does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every pull request, including from forks, and every push to a branch other than `main` | pytest for the Inference Service, `tsc` + jest for the Control Plane, `tsc` for the web app. Needs no secrets. |
| [`deploy.yml`](../.github/workflows/deploy.yml) | every push to `main`, and **Actions → Deploy → Run workflow** | runs `ci.yml`, then deploys to the application VM the parts that changed |

Which parts a push to `main` deploys:

| Changed | Deployed with |
|---|---|
| `kserve-custom-runtime/` | [`deploy_inference.sh`](deploy_inference.sh) |
| `explainable-platform-service/`, `explainable-platform/`, `docker-compose.prod.yml`, `deployment/nginx.conf` | [`deploy_all.sh`](deploy_all.sh) |

When both changed, the Inference Service goes first. Nothing is deployed if any test fails. These are the same scripts you can run from a laptop (see [docs/deployment.md](../docs/deployment.md#3-deploying-changes)). The workflow only gives them an SSH key instead of a password.

**A fork deploys nothing until you configure it.** Without the `DEPLOY_HOST` variable, `deploy.yml` runs the tests and stops with a note that deployment is not configured.

## Turning on deploys for your fork

Before you start, have the two VMs running as described in [docs/deployment.md](../docs/deployment.md) (steps 1 and 2), and the repository cloned on the application VM.

**The quick way:** from your clone, after you have logged in to the VM over SSH once by hand:

```bash
bash deployment/setup_github_deploy.sh <user>@<app-vm-host> [http://<web-ui-address>]
```

It does steps 1 to 3 below. It asks for the VM password once and the sudo password once, and checks that the key and passwordless sudo work. The steps below describe the same thing done by hand.

### 1. A deploy key

On your own machine, create a key that only GitHub Actions will use:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/.ssh/xaiserve_deploy
```

Authorize it on the application VM:

```bash
ssh-copy-id -i ~/.ssh/xaiserve_deploy.pub <user>@<app-vm-host>
```

### 2. Passwordless sudo for the deploy commands

The scripts use `sudo`, and nobody is there to type a password in Actions. On the VM, check where the commands live:

```bash
command -v docker systemctl journalctl nginx cp
```

On Debian 12 that prints `/usr/bin/docker`, `/usr/bin/systemctl`, `/usr/bin/journalctl`, `/usr/sbin/nginx` and `/usr/bin/cp`. If a path differs, use yours below. Write the rule, have `visudo` check it, and install it:

```bash
DEPLOY_USER=$(whoami)
cat > /tmp/xaiserve-deploy <<EOF
# Commands run by deploy_inference.sh and deploy_all.sh from GitHub Actions.
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/bin/docker, \\
    /usr/bin/systemctl restart inference.service, \\
    /usr/bin/systemctl status inference --no-pager, \\
    /usr/bin/systemctl reload nginx, \\
    /usr/bin/journalctl -u inference -n 60 --no-pager, \\
    /usr/sbin/nginx -t, \\
    /usr/bin/cp /tmp/platform-nginx.conf /etc/nginx/sites-available/platform
EOF
sudo visudo -cf /tmp/xaiserve-deploy && sudo install -m 440 -o root -g root /tmp/xaiserve-deploy /etc/sudoers.d/xaiserve-deploy
```

Every other command still asks for the password.

> **`sudo docker` without a password is as powerful as root.** Whoever holds the deploy key controls the VM. Keep the private key only in the GitHub secret, and delete the local copy once it is stored, if you do not need it.

### 3. Variables and secrets

In your repository, open **Settings → Secrets and variables → Actions**. Add these to the **Variables** tab:

| Variable | Required | Value |
|---|---|---|
| `DEPLOY_HOST` | yes | the application VM's address. Setting it turns deploys on. |
| `DEPLOY_USER` | yes | the SSH user on that VM |
| `DEPLOY_PATH` | no | where the repository is on the VM. Default `/home/<user>/explainable-ai-microbiome-platform`. |
| `INFERENCE_IMAGE` | no | the image tag the `inference` systemd unit runs. Default is the one `setup_inference.sh` uses; set this only if you changed `IMAGE` there. |
| `DEPLOY_URL` | no | the web UI's address, shown as a link on each deployment |

Add these to the **Secrets** tab:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | the whole private key file `~/.ssh/xaiserve_deploy`, from `-----BEGIN` to `-----END … KEY-----` |
| `DEPLOY_KNOWN_HOSTS` | the VM's SSH host key, in `known_hosts` format |

With the GitHub CLI, from your clone:

```bash
gh variable set DEPLOY_HOST --body <app-vm-host>
gh variable set DEPLOY_USER --body <user>
gh secret set DEPLOY_SSH_KEY < ~/.ssh/xaiserve_deploy
ssh-keygen -F <app-vm-host> | grep -v '^#' | gh secret set DEPLOY_KNOWN_HOSTS
```

For the last line, take the host key from a machine that has already logged in to the VM, and compare its fingerprint (`ssh-keygen -F <app-vm-host> -l`) with the one the VM reports (`sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VM). If the VM is rebuilt and gets a new host key, deploys stop with `Host key verification failed` until the secret is updated. That way they never connect to a machine you have not checked.

### 4. First deploy

Run **Actions → Deploy → Run workflow** with `all`. The **SSH access** step checks the key, the host key and passwordless sudo, and fails with a pointer here if one is missing. Each deploy script ends with its health check:
- `Inference service is READY.` for the Inference Service
- five `ok` lines for the app

The deploys are recorded under the `production` environment (**Code → Deployments**).

## Rolling back

Run **Deploy** by hand. Under **ref**, give the commit, tag or branch to go back to, then choose what to deploy. It runs the tests of that commit and deploys it. Two limits:

- The commit must contain `deployment/ci_ssh_setup.sh`. Anything older has to be deployed from a laptop with the scripts.
- The Control Plane creates new database columns when it starts (TypeORM `synchronize`) and does not remove them. An older version runs alongside columns it does not know, which is harmless for nullable columns, but check before going back across a schema change.

## Requiring approval before deploys (optional)

**Settings → Environments → production → Required reviewers.** With a reviewer set, every deploy waits for an approval in the Actions tab.

## When it fails

| Message | Cause |
|---|---|
| `Deploy settings missing: …` | a variable or secret above is not set |
| `Permission denied (publickey)` | the public key is not in `~<user>/.ssh/authorized_keys` on the VM, or `DEPLOY_SSH_KEY` does not hold the whole private key |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match the VM |
| `sudo needs a password` / `sudo: a password is required` | the sudoers rule is missing, or a command path or its arguments differ from the rule |
| `Inference service did not become ready` | the log printed below it, from `journalctl -u inference` |
| a health check line ends in `FAIL` | the backend log printed below it |
