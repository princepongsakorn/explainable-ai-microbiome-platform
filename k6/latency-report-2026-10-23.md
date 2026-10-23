# Report: XAIServe response time with k6, rerun after the prediction fixes (for Section IV-C)

Measured on 2026-10-23 (Asia/Bangkok) against the deployed system on Google Cloud. **This replaces the 2026-10-14 report for every end-to-end figure.** The 2026-10-14 prediction time (542.6 s) came from a serving inefficiency that has since been fixed (Section 5).

**In git:** results in `k6/results/2026-10-23-crc-rynazal-331x865-shap-worker/`.

## 1. What was measured

- **Model:** `crc-rynazal-notebook` version 1 (Production; MLflow run `8e4e264d324e4caf9138252a5d2e5833`). Every Prediction recorded `modelVersion` = 1.
- **Data:** YachidaS_2019, 331 samples × 865 features (`sample-data/yachidas_2019_test.csv`).
- **Run pattern:** 1 virtual user, 5 iterations one after another. A response-time measurement, not a load or scalability test.
- **Load generator:** k6 v1.0.0 on the owner's laptop (Apple M1), outside Google Cloud.
  - End to end: internet → nginx → Control Plane.
  - Inference Service: SSH tunnel to the VM's `127.0.0.1:8080`.
- **Clocks:** both start when the CSV upload is sent, so both include the upload. Prediction (a) and explanation (b) run in parallel on the server. **The two times overlap and must not be added together.**

## 2. Summary (seconds)

### 2.1 End to end through the Control Plane (the main figures)

| Measure | Mean | Median | Min | Max | Failed runs |
|---|---|---|---|---|---|
| Upload request (CSV → response) | 4.84 | 4.44 | 3.45 | 7.30 | 0/5 |
| **(a) Prediction, all 331 samples done** | **17.70** | 16.77 | 15.51 | 22.68 | 0/5 |
| **(b) Explanation payload ready** | **94.68** | 93.66 | 92.19 | 99.04 | 0/5 |
| Payload download | 1.18 | 1.04 | 1.03 | 1.49 | 0/5 |

- **Samples:** all 5 × 331 = 1,655 SUCCESS, none failed.
- **Payload:** 331 × 865 SHAP values, 2,768,092 bytes (2.64 MiB) uncompressed. Stored and served gzip-compressed. On 2026-10-14 that was 608,404 bytes (594 KiB); the payload format has not changed since.
- **Prediction after the upload had been accepted** (clock from the upload response): 12.86 s mean, 12.33 s median.
- **Cold vs warm:** run 1 hit a freshly restarted Inference Service whose model was not loaded yet: prediction 22.68 s, explanation 99.04 s. Runs 2–5 average 16.45 s and 93.60 s.

### 2.2 Inference Service called directly (supporting figures)

Calls are pinned with `?version=1`. The schema check passed: 865 = 865 features, none missing or extra. 0 of 41 requests failed.

| Measure | Mean | Median | Min | Max | Failed runs |
|---|---|---|---|---|---|
| `/v1/predict`, 331 samples in one request | 2.37 | 2.18 | 2.00 | 3.39 | 0/5 |
| `/v1/explain/values`, 7 chunks in sequence (chunk = 50) | 92.59 | 93.15 | 91.34 | 93.57 | 0/5 |
| One 50-sample chunk (30 chunks) | 13.88 | 13.83 | 12.84 | 14.88 | 0 |

**Explanation time is SHAP computation.** Calling the Inference Service directly takes 92.6 s, and through the whole platform 94.7 s. The platform adds about 2 s (upload, queue, gzip, storage), as it did on 2026-10-14.

## 3. Before and after

| Measure (mean, s) | 2026-10-14 | 2026-10-23 | Change |
|---|---|---|---|
| (a) Prediction, all 331 done | 542.55 | **17.70** | −96.7 % (about 31× faster) |
| (b) Explanation payload ready | 107.90 | **94.68** | −12.3 % |
| Upload | 4.67 | 4.84 | about the same |
| Payload download | 2.55 | 1.18 | internet path only |
| Direct `/v1/predict`, 331 in one request | 2.22 | 2.37 | about the same |
| Direct `/v1/explain/values`, 7 chunks | 105.60 | 92.59 | −12.3 % |
| One 50-sample explain chunk | 15.79 | 13.88 | −12.1 % |

Prediction is now about 5× faster than the explanation, the expected order: the model predicts, and SHAP is the expensive step.

## 4. Hardware and software

**Application VM** (Control Plane, Inference Service, web UI, nginx, PostgreSQL, Redis, all on one machine). Same machine as on 2026-10-14:

| | |
|---|---|
| Machine type | Google Compute Engine `e2-custom-2-6144` |
| CPU / RAM | 2 vCPU (Intel Xeon @ 2.20 GHz), 6 GB |
| Disk / zone | 30 GB persistent disk, `us-central1-c` |
| OS / Docker | Debian 12, kernel 6.1; Docker 29.4.1 |
| Inference Service | `kserve-shap-model:latest` under systemd. Two processes: the API plus one SHAP worker. 474 MB + 353 MB RSS after the runs; the VM used 1.9 of 5.9 GB in total. |
| Code | Inference Service from `main` @ `555865e`, deployed by the GitHub Actions workflow. Control Plane from `main` @ `5ff3f7d`. |

**Server-side PNG plots:** off. Charts are drawn in the browser from the payload.

**MLflow VM:** specs still not collected.

## 5. What changed since 2026-10-14, and why (for the methods or discussion text)

1. **One request per sample.** The Control Plane used to send one `/v1/predict` request per sample, and each cost about 1.4 s whatever its size. 331 requests × 1.41 s accounts for most of the old 542 s. The fix sends samples in chunks of 50, so 7 requests, the same chunking the explanation already used. Each sample still gets its own status, result and error.
2. **SHAP blocked predictions.** With chunking alone, a rerun on 2026-10-15 timed out 300 of 331 samples at the Control Plane's 120 s request limit; its results are discarded.
   - The cause: SHAP's `TreeExplainer` computes in C without releasing Python's global interpreter lock. While one 50-sample chunk was being explained (about 15 s on this VM), no other request in the Inference Service could run.
   - The fix: the Inference Service computes SHAP in a separate worker process, forked when the service starts, so predictions run while an explanation is in progress.
   - Explanation values are identical either way. Checked element by element against the in-process computation.
3. **No change to the architecture, the API or the deployment.** The Control Plane, Inference Service and MLflow registry and their interfaces are as described in Section III. The worker process is internal to the Inference Service. The text in [69], "returns a probability and a predicted class for each sample, and then computes the SHAP values", describes the observed order: predictions finish within seconds, explanations about 77 s later.

## 6. Points that affect how the numbers should be read

1. **Explanation time is SHAP computation:** 92.6 s directly against 94.7 s end to end. Both are about 12 % faster than on 2026-10-14, in the direct measurement too, which involves neither the Control Plane nor any concurrent prediction. The SHAP algorithm, model and data are unchanged, so the difference is in how the work is run on the VM, not in what is computed. The cause was not isolated: it could be the separate worker process or a difference in the VM between the two days. Report the new figures, not the reduction.
2. **Prediction time includes the upload** (about 4.8 s of the 17.7 s). The 2026-10-14 figure was measured the same way, so the two are comparable.
3. **Do not compare with the old paper numbers** (inference 10.8 s; pipeline 1 min 10 s; 10 VU 60 s). They came from the old system with a different model, dataset and test pattern.
4. **The 2026-10-15 run is excluded.** It ran before the SHAP worker existed: 300 of 331 samples timed out. It shows why the fix was needed, but it is not a measurement of the current system.
5. **k6's `http_req_failed` 87.23 % (328/376)** counts the expected `404 Explanation is not ready yet` replies while polling once a second for (b). These are not errors.
6. **Single-VM deployment.** Everything shares one 2-vCPU machine. SHAP occupies one core, which leaves the other for predictions, the API and the database. A larger machine, or several users explaining at the same time, would give different numbers. This is a single-user measurement.

## 7. Raw data per run (seconds)

**End to end** (seconds)

| Run | Upload | (a) Prediction | (b) Explanation | Download | Samples SUCCESS |
|---|---|---|---|---|---|
| 1 (cold) | 7.30 | 22.68 | 99.04 | 1.29 | 331/331 |
| 2 | 4.44 | 16.77 | 92.19 | 1.03 | 331/331 |
| 3 | 4.90 | 17.50 | 95.52 | 1.04 | 331/331 |
| 4 | 3.45 | 15.51 | 93.02 | 1.04 | 331/331 |
| 5 | 4.10 | 16.04 | 93.66 | 1.49 | 331/331 |

**Inference Service direct** (seconds)

| Run | Predict 331 | Explain 7 chunks | Each chunk (50, 50, 50, 50, 50, 50, 31) |
|---|---|---|---|
| 1 (cold) | 3.39 | 91.34 | 14.5, 13.6, 13.6, 13.5, 13.2, 14.0, 9.0 |
| 2 | 2.18 | 93.53 | 13.9, 13.9, 13.7, 13.6, 13.6, 14.9, 10.0 |
| 3 | 2.24 | 93.57 | 14.7, 14.5, 14.0, 13.9, 13.6, 13.8, 9.0 |
| 4 | 2.00 | 93.15 | 14.2, 14.1, 13.8, 14.0, 13.7, 14.0, 9.4 |
| 5 | 2.01 | 91.36 | 13.9, 13.8, 13.6, 14.3, 12.8, 13.7, 9.2 |

## 8. Suggested wording for the paper (edit as needed)

> Response time was measured with k6 against the deployed system: a single `e2-custom-2-6144` VM (2 vCPU, 6 GB RAM) hosting the Control Plane and the Inference Service. The test used `crc-rynazal-notebook` v1 on the YachidaS_2019 cohort (331 samples × 865 features). A single user submitted the cohort through the web API five times in sequence, and time was measured from the start of the upload. Predictions for all 331 samples were available after 17.7 s on average (median 16.8 s, range 15.5–22.7 s, including a 4.8 s upload). The SHAP explanation for the full cohort, 331 × 865 values, was available after 94.7 s (median 93.7 s, range 92.2–99.0 s). All 1,655 sample predictions and all five explanation jobs completed successfully. Calling the Inference Service directly, prediction for all 331 samples took 2.4 s in a single request and the explanation 92.6 s, so the explanation time is dominated by SHAP computation; the platform adds about 2 s. Because prediction and explanation run concurrently, a user sees predictions within seconds and the explanation about 77 s later.

Optional, if Section III should mention it:

> To keep predictions responsive while explanations are computed, the Inference Service runs SHAP in a separate worker process.

## 9. Outstanding

- **Test data on the VM to delete** (dry run first, then apply):
  - 2026-10-15: Predictions `c2192cfa-fb4e-4eab-b3c4-ea6d9384e8b7` and `8cbedb7a-dcee-4ac6-9f47-11b570e3cf05`, plus any later Prediction from that aborted run. Find them by `createdAt` on 2026-10-15 after 15:47 UTC.
  - 2026-10-23: `4c0ce563-8614-46d3-843e-1c29ecebf8ed`, `d7976748-415e-4619-930e-6ce11bb34185`, `ca958408-0d77-4da6-bf10-379527239164`, `f90bf5ad-ab43-4f1b-b5a8-2d441a5423c9`, `49d167a1-f2e9-4a14-8fbb-10d277d311e7`.
  - The `k6-latency` user, their explanation objects in GCS, and the completed Bull jobs.
- **MLflow VM specs**, if the paper needs them.
