# Response time: crc-rynazal-notebook v1, YachidaS_2019 (331 × 865), after the prediction fixes

Measured on 2026-10-23 (Asia/Bangkok) against the Google Cloud deployment. This is the same measurement as [2026-10-14](../2026-10-14-crc-rynazal-331x865/README.md), repeated after two changes to how predictions are served:

- **The Control Plane predicts records in chunks of 50** instead of one request per record (PR #9).
- **The Inference Service computes SHAP in a separate worker process** (PR #10).

Setup is the same: one virtual user and five iterations run one after another. This measures response time, not load or scalability. Hardware, software and network path are in [environment.md](environment.md).

## End to end through the Control Plane

`k6/scripts/e2e_prediction.js` uploads the CSV with `POST /api/predict`, then polls once a second until two things are true:
- (a) all 331 Samples have a result
- (b) `GET /api/predict/:id/explain` returns the payload

Both clocks start when the upload is sent, so both include the upload. (a) and (b) run in parallel on the server: the times overlap and must not be added together.

| Measure | Mean (s) | Median (s) | Min (s) | Max (s) | Failed runs |
|---|---|---|---|---|---|
| Upload request (CSV sent → response) | 4.84 | 4.44 | 3.45 | 7.30 | 0 / 5 |
| (a) Prediction, all 331 Samples done | 17.70 | 16.77 | 15.51 | 22.68 | 0 / 5 |
| (b) Explanation payload ready | 94.68 | 93.66 | 92.19 | 99.04 | 0 / 5 |
| Payload download (after both are done) | 1.18 | 1.04 | 1.03 | 1.49 | 0 / 5 |

- All 5 × 331 = 1,655 Samples ended in SUCCESS, and every Prediction recorded `modelVersion` 1.
- Payload: 2,768,092 bytes uncompressed in every run, holding 331 × 865 SHAP values. The format is the same as on 2026-10-14.
- Counted from the upload *response* rather than the request, prediction finished 12.86 s later on average (median 12.33 s, range 11.94–15.38 s).
- k6 reports `http_req_failed` 87.23 % (328 of 376). These are the expected `404 Explanation is not ready yet` answers while polling for (b): k6 counts every 4xx as failed. None of the measured requests failed.

### Per run (s)

| Run | Upload | (a) Prediction | (b) Explanation | Download | Samples SUCCESS |
|---|---|---|---|---|---|
| 1 (cold) | 7.30 | 22.68 | 99.04 | 1.29 | 331 / 331 |
| 2 | 4.44 | 16.77 | 92.19 | 1.03 | 331 / 331 |
| 3 | 4.90 | 17.50 | 95.52 | 1.04 | 331 / 331 |
| 4 | 3.45 | 15.51 | 93.02 | 1.04 | 331 / 331 |
| 5 | 4.10 | 16.04 | 93.66 | 1.49 | 331 / 331 |

Run 1 started on a freshly restarted Inference Service: the model had not been loaded yet, and each of its two processes loaded it once from the local disk cache, not from MLflow. Runs 2–5 average 4.22 s upload, 16.45 s prediction and 93.60 s explanation.

## Compared with 2026-10-14

| Measure (mean, s) | 2026-10-14 | 2026-10-23 | Change |
|---|---|---|---|
| (a) Prediction, all 331 done | 542.55 | 17.70 | −96.7 % (about 31× faster) |
| (b) Explanation payload ready | 107.90 | 94.68 | −12.3 % |
| Upload | 4.67 | 4.84 | about the same |
| Payload download | 2.55 | 1.18 | internet path; the payload is the same size |

## What changed, and why

- **One request per record.** On 2026-10-14 the Control Plane sent one `/v1/predict` per Sample, and each request cost about 1.4 s whatever its size. 331 × 1.41 s is most of the 542 s measured. PR #9 sends records in chunks of 50, so 7 requests instead of 331.
- **SHAP blocked predictions.** With chunking alone, a rerun on 2026-10-15 timed out 300 of 331 records at the Control Plane's 120 s limit; those results are not used. SHAP's TreeExplainer computes in C without releasing Python's global interpreter lock, so while a 50-Sample chunk was being explained (about 15 s on this VM) no other request in the Inference Service could run. PR #10 moves SHAP to a separate worker process, forked at startup. Predictions now run while an explanation is being computed. The API and the deployment are unchanged.
- **Explanation is a little faster** because it no longer shares the Inference Service process with 331 prediction requests.
- **Memory cost** of the worker process: after the runs, the Inference Service's main process held 474 MB and the SHAP worker 353 MB (RSS). The VM used 1.9 of 5.9 GB in total.

## Not repeated

The direct Inference Service measurement (`inference_direct.js`) was not run this time. The 2026-10-14 figures (`/v1/predict` of 331 Samples in one request: 2.22 s; `/v1/explain/values` in 7 chunks: 105.60 s) were taken on the earlier runtime.

## Notes

- The Control Plane is the build deployed on 2026-10-15 from `main` @ `5ff3f7d` (PR #9); later commits did not change it. The Inference Service was built and deployed by GitHub Actions from `main` @ `555865e` (includes PR #10) at 14:39 UTC, about an hour before run 1.
- Each run created a real Prediction under the dedicated `k6-latency` user. They are removed afterwards with `k6/scripts/cleanup_vm.sh` (dry run first) and are not part of the platform's data. Prediction ids are listed by `summarize.py`.

## How it was run

```bash
ENV_FILE=~/.xaiserve-k6.env bash k6/scripts/run.sh e2e_prediction 2026-10-23-crc-rynazal-331x865-shap-worker
python3 k6/scripts/summarize.py k6/results/2026-10-23-crc-rynazal-331x865-shap-worker/e2e_prediction-*.stdout.log
```

`ENV_FILE` sets `BASE_URL`, `K6_USERNAME` and `K6_PASSWORD`. It lives outside the repository.

## Files

- `e2e_prediction-*.stdout.log`: k6 output, one `K6RUN` line per iteration
- `e2e_prediction-*.summary.json`: k6 `--summary-export`, with the login token redacted
- `environment.md`: VM specs, software versions, model and data
