# Response time: crc-rynazal-notebook v1, YachidaS_2019 (331 × 865)

Measured on 2026-10-14 (Asia/Bangkok) against the Google Cloud deployment running `main` @ `5925b6c` (model-version pinning). One virtual user, five iterations run one after another per measurement. This measures response time; it is not a load or scalability test. Hardware, software and network path are in [environment.md](environment.md).

## End to end through the Control Plane

`k6/scripts/e2e_prediction.js`: upload the CSV with `POST /api/predict`, then poll until (a) all 331 Samples have a result and (b) `GET /api/predict/:id/explain` returns the payload. Both clocks start when the upload is sent. (a) and (b) run in parallel on the server, so the two times overlap and must not be added together.

| Measure | Mean (s) | Median (s) | Min (s) | Max (s) | Failed runs |
|---|---|---|---|---|---|
| Upload request (CSV sent → response) | 4.67 | 4.44 | 3.83 | 6.31 | 0 / 5 |
| (a) Prediction, all 331 Samples done | 542.55 | 563.17 | 476.11 | 574.30 | 0 / 5 |
| (b) Explanation payload ready | 107.90 | 106.46 | 102.36 | 115.10 | 0 / 5 |
| Payload download (after both are done) | 2.55 | 1.86 | 1.71 | 5.59 | 0 / 5 |

- All 5 × 331 = 1,655 Samples ended in SUCCESS, and every Prediction recorded `modelVersion` 1.
- Payload: 608,404 bytes gzip-compressed (594 KiB) as stored and served; 2,768,092 bytes (2.64 MiB) uncompressed. It holds 331 × 865 SHAP values, contract version 1, model version 1.
- k6 reports `http_req_failed` 14.16 % (261 of 1,842). These are the expected `404 Explanation is not ready yet` answers while polling for (b): k6 counts every 4xx as failed. The number matches about one poll every two seconds for roughly 105 s, over 5 runs. None of the measured requests failed.

## Inference Service called directly

`k6/scripts/inference_direct.js`, through an SSH tunnel to the VM's `127.0.0.1:8080`, so the Control Plane, database and queue are not involved. Every call pins `?version=1`. Before timing, the script explained one Sample and checked the CSV against the model: 865 features on both sides, none missing or extra.

| Measure | Mean (s) | Median (s) | Min (s) | Max (s) | Failed runs |
|---|---|---|---|---|---|
| `/v1/predict`, all 331 Samples in one request | 2.22 | 2.04 | 1.73 | 3.34 | 0 / 5 |
| `/v1/explain/values`, 331 Samples as 7 chunks in sequence | 105.60 | 103.79 | 98.59 | 119.00 | 0 / 5 |
| one 50-Sample explain chunk (30 full chunks) | 15.79 | 15.33 | 13.86 | 20.04 | 0 |

The chunk size is 50, as the Control Plane uses (`CHUNK_SIZE` in `explain.builder.ts`): 6 chunks of 50 and one of 31.

`single_row_predict.txt`: 20 sequential one-Sample `/v1/predict` calls, which is the request the Control Plane sends for each Sample. Mean 1.41 s, min 1.24 s, max 1.73 s, none failed.

## Cold and warm runs

The first iteration of each measurement is not markedly slower than the rest:

| Measure | Cold (1st) (s) | Warm mean, 2nd–5th (s) |
|---|---|---|
| Upload | 6.31 | 4.27 |
| (a) Prediction | 534.15 | 544.65 |
| (b) Explanation | 105.70 | 108.46 |
| Direct predict, 331 in one request | 3.34 | 1.94 |
| Direct explain, 7 chunks | 98.59 | 107.36 |

The model was already loaded when the measurements started, because the Inference Service had served an earlier Prediction (see Notes). So the "cold" run here is the first run of the session, not a model load from MLflow.

## What the numbers mean

- **Explanation is dominated by SHAP compute.** Explaining directly takes 105.6 s on average, and the explanation is ready through the Control Plane after 107.9 s. The platform adds about 2 s on top of the computation (upload, queue, gzip, GCS write).
- **Prediction is dominated by per-request overhead, not by the model.** The model predicts all 331 Samples in about 2 s in one request. The Control Plane sends one request per Sample, and each costs about 1.4 s whatever its size: 331 × 1.41 s ≈ 467 s of the 476–574 s measured. The explanation job runs on the same 2-vCPU VM during the first ~105 s and competes for CPU, which accounts for part of the rest.
- **No request failed** in either measurement.

## Notes

- An earlier attempt at 17:57 was abandoned because the k6 laptop went to sleep mid-run. Its Prediction kept the Inference Service busy until 18:43, and the measurements above started only once the service was idle again. The aborted run is not included in these results.
- Payload download time depends on the internet path between the laptop (outside Google Cloud) and the VM. The 5.59 s outlier is one slow transfer of the same 594 KiB.
- Each run created a real Prediction under a dedicated `k6-latency` user. These Predictions, their records, explanation objects and queue jobs, and the user itself are removed with `k6/scripts/cleanup_vm.sh` (dry run first). They are not part of the platform's data.

## How it was run

```bash
ssh -M -S ~/.ssh/cm-xaiserve -o ControlPersist=6h -fN -L 18080:127.0.0.1:8080 <user>@<app-vm-host>
ENV_FILE=~/.xaiserve-k6.env bash k6/scripts/run.sh e2e_prediction 2026-10-14-crc-rynazal-331x865
ENV_FILE=~/.xaiserve-k6.env bash k6/scripts/run.sh inference_direct 2026-10-14-crc-rynazal-331x865
python3 k6/scripts/summarize.py k6/results/2026-10-14-crc-rynazal-331x865/e2e_prediction-*.stdout.log
python3 k6/scripts/summarize.py k6/results/2026-10-14-crc-rynazal-331x865/inference_direct-*.stdout.log
```

`ENV_FILE` sets `BASE_URL`, `K6_USERNAME`, `K6_PASSWORD` and `INFERENCE_URL` (here `http://127.0.0.1:18080`). It lives outside the repository.

## Files

- `e2e_prediction-*.stdout.log`, `inference_direct-*.stdout.log`: k6 output with one `K6RUN` line per iteration
- `*.summary.json`: k6 `--summary-export`
- `single_row_predict.txt`: the single-Sample predict timings
- `environment.md`: VM specs, software versions, model and data
