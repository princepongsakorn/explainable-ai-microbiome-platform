# Environment

Measured on 2026-10-14 (Asia/Bangkok).

## Code and model

| | |
|---|---|
| Deployed code | `main` @ `5925b6c` (model-version pinning, PR #8). The VM is deployed by rsync and has no git checkout; the owner confirmed it matches this commit. |
| Model | `crc-rynazal-notebook` version 1, Production stage (MLflow run `8e4e264d324e4caf9138252a5d2e5833`) |
| Data | YachidaS_2019, `sample-data/yachidas_2019_test.csv`: 331 samples × 865 features (plus a `sample_id` column) |
| Explanation chunk size | 50 samples per `/v1/explain/values` call (`CHUNK_SIZE` in `explain.builder.ts`), so 7 calls for 331 samples (6 × 50 + 31) |
| Prediction calls | The Control Plane calls `/v1/predict` once per sample (331 queue jobs) |
| Server-side PNG plots | Off (`GENERATE_PNG_PLOTS` unset, default false); charts are drawn in the browser from the explanation payload |

## Application VM (Control Plane, Inference Service, web UI, nginx, PostgreSQL, Redis)

| | |
|---|---|
| Machine type | `e2-custom-2-6144` (Google Compute Engine) |
| vCPU | 2 (Intel Xeon @ 2.20 GHz, 1 core × 2 threads) |
| RAM | 6 GB (5.8 GiB reported by `free`) |
| Disk | 30 GB persistent disk (78 % used at the time of measurement) |
| Zone | `us-central1-c` |
| OS | Debian GNU/Linux 12 (bookworm), kernel 6.1.0-51-cloud-amd64 |
| Docker | 29.4.1 |
| Containers | Compose: `postgres:14`, `redis:7-alpine`, Control Plane (NestJS), web UI (Next.js), nginx. Inference Service: `kserve-shap-model:latest` run by the `inference` systemd unit (image name from `setup_inference.sh`; the running tag could not be confirmed because `docker ps` needs sudo) |

The explanation payload is stored as gzip JSON in Google Cloud Storage; its key and SHA-256 are in PostgreSQL.

## MLflow VM (MLflow tracking server and model registry)

Specs not collected: no SSH access to this VM at the time of measurement.

## Load generator

| | |
|---|---|
| k6 | v1.0.0 (go1.24.2, darwin/arm64) |
| Host | The owner's laptop (Apple M1, macOS 14.6.1), outside Google Cloud |
| End-to-end path | laptop → public internet → nginx (HTTP, port 80) on the application VM → Control Plane |
| Direct path | laptop → SSH tunnel → Inference Service on the VM's `127.0.0.1:8080` |
| Users | 1 virtual user, 5 iterations run one after another per measurement |
