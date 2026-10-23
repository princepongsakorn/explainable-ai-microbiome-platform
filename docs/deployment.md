# Deploying XAIServe

This guide sets up the reference deployment on Google Cloud: one VM for the MLflow registry and one VM for the application. The scripts it uses are in [`deployment/`](../deployment). A Kubernetes alternative for the inference service is at the end.

```
MLflow VM                               Application VM
├─ PostgreSQL (MLflow backend store)    ├─ nginx on :80 → web UI and /api
└─ MLflow server on :5000 ─── GCS ───── ├─ Docker Compose: API, web UI, PostgreSQL, Redis
                              bucket    └─ inference service on :8080 (Docker under systemd)
```

The MLflow server stores artifacts in a GCS bucket. The API stores explanation payloads in the same bucket under a separate prefix.

## Before you start

You need:

- A Google Cloud project with the `gcloud` CLI set up on your machine.
- Two Ubuntu 22.04 VMs. Give the application VM a boot disk of at least 30 GB, because the inference image includes PyTorch. Give both VMs the `cloud-platform` access scope, so the default compute service account can reach GCS.
- A GCS bucket. The scripts default to the bucket used during development, so pass your own name through `GCS_BUCKET` everywhere below.
- SSH access to both VMs as a user with `sudo`.

Grant the compute service account access to the bucket. On the application VM it also signs the time-limited download URLs for explanation files, so it needs the token creator role on itself:

```bash
SA=<project-number>-compute@developer.gserviceaccount.com
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator
```

## 1. MLflow VM

### PostgreSQL

Install PostgreSQL and create a database for MLflow:

```bash
sudo apt-get update && sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER mlflow_user WITH PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE mlflow_db OWNER mlflow_user;"
```

`setup_mlflow.sh` reads the connection details from `/root/mlflow_db_credentials.txt`. Create it, readable only by root:

```bash
sudo tee /root/mlflow_db_credentials.txt >/dev/null <<'EOF'
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mlflow_db
DB_USER=mlflow_user
DB_PASSWORD=<db-password>
EOF
sudo chmod 600 /root/mlflow_db_credentials.txt
```

### MLflow server

Copy the script to the VM and run it:

```bash
scp deployment/setup_mlflow.sh <user>@<mlflow-vm-host>:~
ssh <user>@<mlflow-vm-host>
sudo GCS_BUCKET=gs://<bucket> ./setup_mlflow.sh
```

The script installs MLflow with basic authentication into `/opt/mlflow`, runs it as the `mlflow` systemd service on port 5000, and uploads a test artifact through the server to check that GCS works. It generates the admin password unless you pass `MLFLOW_ADMIN_PASSWORD`, and saves it in `/root/mlflow_credentials.txt`. Running the script again reuses the saved password.

Then open port 5000 only to the addresses that need it: the application VM and the machines you train models on.

```bash
gcloud compute firewall-rules create allow-mlflow-5000 \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:5000 --source-ranges=<app-vm-ip>/32,<your-ip>/32
```

MLflow basic auth sends the password in clear text over HTTP. Put nginx with a TLS certificate in front of it before you open it more widely.

### Check the MLflow server

[`deployment/smoke_test.py`](../deployment/smoke_test.py) runs four checks on the MLflow VM. It writes a run to PostgreSQL, uploads an artifact through the server, finds that artifact in the bucket with the GCS SDK, and downloads it again:

```bash
scp deployment/smoke_test.py <user>@<mlflow-vm-host>:~
ssh <user>@<mlflow-vm-host>
sudo /opt/mlflow/venv/bin/pip install google-cloud-storage
export MLFLOW_TRACKING_PASSWORD=<admin password from /root/mlflow_credentials.txt>
export GCS_BUCKET=<bucket>
sudo -E /opt/mlflow/venv/bin/python smoke_test.py
```

## 2. Application VM

Clone the repository on the VM into the SSH user's home directory, where the scripts expect it:

```bash
ssh <user>@<app-vm-host>
git clone https://github.com/princepongsakorn/explainable-ai-microbiome-platform.git
cd explainable-ai-microbiome-platform
```

### Inference service

`setup_inference.sh` installs Docker, pulls the inference image and runs it as the `inference` systemd service on port 8080. The service uses the MLflow admin account, because it also creates the per-user MLflow accounts behind the access tokens on the Developer page.

```bash
sudo MLFLOW_URL=http://<mlflow-vm-host>:5000 \
     MLFLOW_TRACKING_USERNAME=admin \
     MLFLOW_TRACKING_PASSWORD='<admin password>' \
     deployment/setup_inference.sh
```

The credentials go into `/etc/inference/inference.env`, readable only by root. The published image can lag behind the source, so build the current one from the repository afterwards with `deploy_inference.sh` (see step 3).

Port 8080 does not need a firewall rule: the API reaches the inference service on the same VM.

### API, web UI and nginx

```bash
sudo GCS_BUCKET=<bucket> deployment/setup_app.sh
```

The script:

1. Installs nginx and applies [`deployment/nginx.conf`](../deployment/nginx.conf), which serves the web UI at `/` and the API at `/api/`, with buffering turned off for the server-sent events under `/api/events/`.
2. Creates `explainable-platform-service/.env` from `.env.example` and fills in a random `JWT_SECRET`, the bucket, and the internal addresses of the inference service, PostgreSQL and Redis.
3. Generates `POSTGRES_PASSWORD` in `.env` at the repository root. [`docker-compose.prod.yml`](../docker-compose.prod.yml) reads it from there and has no default.
4. Builds and starts the stack with Docker Compose. The API and web UI listen on `127.0.0.1` only, so nginx is the only way in.

The first build takes 5 to 15 minutes. Then open port 80, preferably to your own address only until TLS is set up:

```bash
gcloud compute firewall-rules create allow-app-80 \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:80 --source-ranges=<your-ip>/32
```

For HTTPS, point a domain at the VM and run `sudo certbot --nginx -d <domain>`.

### Moving an existing installation to `POSTGRES_PASSWORD`

Older versions of `docker-compose.prod.yml` fell back to a fixed PostgreSQL password. PostgreSQL only reads `POSTGRES_PASSWORD` when it creates its data volume, so on a VM that already has the `platform_postgres_data` volume, set the password explicitly before the next deploy:

```bash
cd ~/explainable-ai-microbiome-platform
NEW_PASSWORD=$(openssl rand -hex 24)
sudo docker exec -it postgres-platform \
  psql -U postgres_user -d explainable_platform_db \
  -c "ALTER USER postgres_user WITH PASSWORD '$NEW_PASSWORD';"
echo "POSTGRES_PASSWORD=$NEW_PASSWORD" > .env && chmod 600 .env
sudo deployment/setup_app.sh   # rewrites DATABASE_URL with the new password
```

### Setting or rotating `JWT_SECRET`

The API signs login tokens with `JWT_SECRET` from `explainable-platform-service/.env`. `setup_app.sh` generates it only when the line is missing or still holds the `replace-me` placeholder from `.env.example`, so it never replaces a secret that is already set. To set it by hand, or to rotate it after it may have leaked:

```bash
cd ~/explainable-ai-microbiome-platform
NEW_SECRET=$(openssl rand -hex 32)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_SECRET|" explainable-platform-service/.env
chmod 600 explainable-platform-service/.env
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

Compose reads `env_file` only when it creates the container, so `docker restart backend` is not enough. Every token signed with the old secret stops working, so all users have to log in again. Do not commit `.env` or paste the secret anywhere.

## 3. Deploying changes

Three scripts push local changes to the application VM over SSH and rsync. Each one takes the VM from `VM_SSH`, rebuilds what changed and runs a health check. None of them touches the `.env` files on the VM.

```bash
VM_SSH=<user>@<app-vm-host> bash deployment/deploy_inference.sh   # inference service
VM_SSH=<user>@<app-vm-host> bash deployment/deploy_frontend.sh    # web UI only
VM_SSH=<user>@<app-vm-host> bash deployment/deploy_all.sh         # API, nginx and web UI
```

The scripts assume the repository on the VM is at `/home/<user>/explainable-ai-microbiome-platform`. Set `VM_PROJECT_DIR` if it is elsewhere.

GitHub Actions can run these scripts on every push to `main` instead, after the tests pass. To turn that on for your repository, follow [deployment/README-github-actions.md](../deployment/README-github-actions.md).

## 4. First model

1. Open the web UI, sign up, and go to the Developer page. Generate an access token there. It is the password of your MLflow account, and the page shows it in full only once.
2. Train and log a model with `log_explainable_model`, as in the [README](../README.md#1-train-and-log-an-explainable-model). [`mlflow-experiments/sample-rf-crc/model.py`](../mlflow-experiments/sample-rf-crc/model.py) is a complete example; it reads `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME` and `MLFLOW_TRACKING_PASSWORD` from the environment.
3. On the Experiments page, register the run and publish it. The inference service re-checks the registry at most once a minute, so the model appears on the prediction page within about a minute.
4. Upload one of the CSV files in [`sample-data/`](../sample-data) to check the whole path.

## Kubernetes with KServe

[`kserve-custom-runtime/deployment/`](../kserve-custom-runtime/deployment) runs the same inference image as a KServe `InferenceService`. MLflow, the API and the web UI still run as described above, and the API's `INFERENCE_SERVICE_URL` points at the service's URL instead of `host.docker.internal:8080`.

1. Install KServe on the cluster ([KServe quickstart](https://kserve.github.io/website/latest/get_started/)).
2. Build the image from `kserve-custom-runtime/` and push it to a registry the cluster can pull from. Set that image in `02.deploy-kserve-shap-modelserver.yaml`.
3. Fill in the placeholders in `01.set-mlflow-secret.yaml`, then apply both files. Keep the filled-in Secret out of version control.

```bash
cd kserve-custom-runtime
docker build -t <registry>/kserve-shap-model:<tag> . && docker push <registry>/kserve-shap-model:<tag>
kubectl apply -f deployment/01.set-mlflow-secret.yaml
kubectl apply -f deployment/02.deploy-kserve-shap-modelserver.yaml
kubectl get inferenceservice kserve-custom-inference-service
```

The service exposes custom Flask routes, not the KServe v1 or v2 inference protocol, so call it at its own paths (`/v1/predict/<model>`, `/v1/explain/values/<model>`).

## Troubleshooting

| Symptom | Check |
|---|---|
| Artifact uploads to MLflow fail | The MLflow VM's access scope is `cloud-platform`, and its service account has `roles/storage.objectAdmin` on the bucket. `smoke_test.py` prints this hint when stage 3 fails. |
| Explanation downloads return 403 | The application VM's service account has `roles/iam.serviceAccountTokenCreator` on itself. |
| Live progress never arrives in the browser | nginx is running the current `nginx.conf`; `deploy_all.sh` applies it and checks `/api/events/` (an HTTP 401 there is the expected answer). |
| A published model does not appear | `curl http://127.0.0.1:8080/v1/mlflow/tracking_uri` on the application VM, then `sudo journalctl -u inference -n 100`. |
| `df -h` still shows the old size after resizing a disk | Run `sudo deployment/expand_disk.sh`. |
