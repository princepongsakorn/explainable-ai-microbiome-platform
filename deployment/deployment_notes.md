# Microbiome XAI Platform — GCP Deployment Notes

## Project
งานวิทยานิพนธ์ ป.โท — deploy ระบบ Microbiome Explainable AI (SHAP) ขึ้น GCP

## GCS Bucket
- **Artifact store**: `gs://microbiome_xai_platform`

## VM IPs (canonical)
| VM | Role | Public IP |
|---|---|---|
| VM #1 | MLflow + PostgreSQL | `35.225.129.127` |
| VM #2 | Inference Service (Flask + SHAP) | `35.239.175.89` |

> หมายเหตุ: Public IP ของ VM เปลี่ยนได้เมื่อ restart/reassign จึงควรใช้ **static external IP** เพื่อไม่ต้องแก้ค่า endpoint ในทุกครั้ง

---

## VM #1 — Database + MLflow Server

**SSH access**
```
ssh print@35.225.129.127
```

**Components**
1. PostgreSQL 15 — MLflow backend store (DB: `mlflow_db`, user: `mlflow_user`)
2. MLflow Server — basic auth, ต่อ Postgres (backend), ต่อ GCS bucket (artifact)

**PostgreSQL credentials**
- DB: `mlflow_db`
- User: `mlflow_user`
- Password: `c3OSyyZEQfjB1vU4ImYVvTKj3Tttoy9f`
- Backend URI: `postgresql://mlflow_user:c3OSyyZEQfjB1vU4ImYVvTKj3Tttoy9f@127.0.0.1:5432/mlflow_db`
- Credentials file on VM: `/root/mlflow_db_credentials.txt`

**MLflow credentials**
- URL: `http://35.225.129.127:5000`
- Admin user: `admin`
- Admin password: `BfKfqfQOwT3qpQyiB72oqDydvjAPrndz`
- Flask secret key: saved to `/root/mlflow_credentials.txt` (drop-in `/etc/systemd/system/mlflow.service.d/override.conf`)

**Status — COMPLETE**
- [x] `setup_postgresql.sh` DONE
- [x] `setup_mlflow.sh` DONE
- [x] Verify MLflow auth (curl 200 OK)
- [x] เปิด GCP firewall port 5000
- [x] Grant `roles/storage.objectAdmin` ให้ compute SA บน bucket
- [x] เปลี่ยน VM OAuth scope เป็น `cloud-platform`
- [x] Pin `google-auth<2.30` + `google-cloud-storage<3.0` (newer versions มี HTTPS metadata bug)
- [x] **e2e smoke test PASS ทั้ง 4 stages** (Postgres backend / GCS upload / GCS SDK verify / round-trip download)

**Lib version pin (สำคัญ — ต้องใส่ใน setup_mlflow.sh ครั้งหน้า)**
```bash
/opt/mlflow/venv/bin/pip install \
  "mlflow[auth]>=2.9.0,<3" \
  "google-auth>=2.20,<2.30" \
  "google-cloud-storage>=2.10,<3.0"
```

**MLflow artifact destination**
- `--artifacts-destination gs://microbiome_xai_platform/mlflow-artifacts`
- Path pattern: `gs://microbiome_xai_platform/mlflow-artifacts/{exp_id}/{run_id}/artifacts/{path}`

---

## VM #2 — Inference Service (Flask + SHAP)

**SSH access**
```
ssh print@35.239.175.89
```

**Components**
1. Docker Engine (official repo)
2. Container `pongsakornpongsutiyakorn/kserve-shap-model` รันผ่าน systemd unit `inference.service`
   - Port 8080
   - Cache volume: `/var/lib/inference/cache` → `/tmp/cache`
   - ENV loaded from `/etc/inference/inference.env` (root-only)

**Architecture decision**
- ไม่ใช้ KServe / K8s / GKE — demo ไม่มี user ไม่ต้อง autoscale
- Flask app ไม่ได้ใช้ KServe v1/v2 inference protocol (ใช้ custom routes)
- เก็บ `kserve-custom-runtime/deployment/*.yaml` ไว้ใน repo เป็น reference สำหรับ production scale path

**Setup scripts**
- `setup_inference.sh` — DONE
- `expand_disk.sh` — utility (ไม่ได้ใช้รอบนี้ เพราะ cloud-init auto-resize)

**Status — service-level COMPLETE**
- [x] Resize boot disk เป็น 30 GB (ผ่าน GCP Console) + auto-expand filesystem
- [x] Rebuild image as **amd64 บน VM** (3-5 min — native build, ไม่ต้อง emulate)
  - `docker rmi` arm64 image เก่า → `docker build` amd64 ใหม่ทับ tag เดิม
  - SCP `kserve-custom-runtime/` ขึ้น VM แล้ว build ตรง — ไม่ push Docker Hub
- [x] Update env file `/etc/inference/inference.env` ชี้ `MLFLOW_URL=http://35.225.129.127:5000`
- [x] Re-enable + restart `inference.service` → active (running)
- [x] Verify `curl http://127.0.0.1:8080/v1/mlflow/tracking_uri` → `{"url":"http://35.225.129.127:5000"}` ✓
- [ ] เปิด GCP firewall port 8080 (เฉพาะจาก VM #3 internal IP — ทำตอน deploy backend)
- [ ] Test `/v1/predict/*` + `/v1/explain/*` end-to-end — ต้องมี model ใน MLflow ที่ stage = Production ก่อน

**Backend change (ตอน deploy backend)**
- [ ] ENV: `INFERENCE_SERVICE_URL=http://<vm2-internal-ip>:8080`
- [x] ลบ `Host` header pattern ของ KServe ออกจาก `mlflow.service.ts`, `experiments.service.ts`, `models.service.ts`, `prediction.processor.ts` แล้ว (รวม k6 test scripts)
- [x] Training scripts (`mlflow-experiments/*/model.py`) แก้ `mlflow.set_tracking_uri(...)` ให้รับจาก `MLFLOW_TRACKING_URI` env (fallback `http://35.225.129.127:5000`)

---

## VM #3 — Backend + Frontend (TBD)

รอ deploy ทีหลัง
