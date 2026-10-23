// End-to-end latency through the Control Plane, one user, runs in sequence.
//
// Each iteration uploads the CSV, then polls until
//   (a) every Sample has a prediction result  -> e2e_prediction_ms
//   (b) the Explanation payload can be fetched -> e2e_explanation_ms
// and downloads the payload once more on its own -> payload_download_ms.
// Both clocks start when the upload request is sent.
//
// Each iteration prints one `K6RUN {json}` line; summarize.py reads them, and
// cleanup reads the predictionIds from them, since a Prediction has no owner or
// name to find it by afterwards.
//
// Required env: BASE_URL (e.g. https://host), K6_USERNAME, K6_PASSWORD.
// Optional env: CSV_PATH, MODEL_NAME, EXPECTED_SAMPLES, ITERATIONS, POLL_MS,
//               MAX_WAIT_S.

import http from 'k6/http';
import { sleep, fail } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const CSV_PATH = __ENV.CSV_PATH || '../../sample-data/yachidas_2019_test.csv';
const MODEL_NAME = __ENV.MODEL_NAME || 'crc-rynazal-notebook';
const EXPECTED_SAMPLES = Number(__ENV.EXPECTED_SAMPLES || 331);
const ITERATIONS = Number(__ENV.ITERATIONS || 5);
const POLL_MS = Number(__ENV.POLL_MS || 1000);
const MAX_WAIT_S = Number(__ENV.MAX_WAIT_S || 1800);

const csv = open(CSV_PATH, 'b');

const uploadMs = new Trend('e2e_upload_ms', true);
const predictionMs = new Trend('e2e_prediction_ms', true);
const explanationMs = new Trend('e2e_explanation_ms', true);
const downloadMs = new Trend('payload_download_ms', true);
const failures = new Counter('e2e_failures');

export const options = {
  scenarios: {
    e2e: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: `${Math.ceil((ITERATIONS * MAX_WAIT_S) / 60) + 10}m`,
    },
  },
  // The upload writes every Sample before it answers, so it is slow by design.
  setupTimeout: '60s',
};

export function setup() {
  if (!BASE_URL || !__ENV.K6_USERNAME || !__ENV.K6_PASSWORD) {
    fail('BASE_URL, K6_USERNAME and K6_PASSWORD must be set');
  }
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: __ENV.K6_USERNAME, password: __ENV.K6_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200 && res.status !== 201) {
    fail(`login failed with HTTP ${res.status}`);
  }
  return { token: res.json('access_token') };
}

function findPrediction(auth, predictionId) {
  // Newest first; a run's own Prediction is on the first page unless someone
  // else uploads more than a page's worth while it runs.
  const res = http.get(`${BASE_URL}/api/predict?page=1&limit=20`, auth);
  if (res.status !== 200) return null;
  return (res.json('items') || []).find((p) => p.id === predictionId) || null;
}

export default function (data) {
  const auth = {
    headers: { Authorization: `Bearer ${data.token}` },
    timeout: '600s',
  };
  const run = { iteration: __ITER, predictionId: null, ok: false };

  const t0 = Date.now();
  const upload = http.post(
    `${BASE_URL}/api/predict`,
    {
      file: http.file(csv, 'k6-yachidas_2019_test.csv', 'text/csv'),
      modelName: MODEL_NAME,
    },
    auth,
  );
  run.uploadMs = Date.now() - t0;
  run.uploadStatus = upload.status;
  if (upload.status !== 200 && upload.status !== 201) {
    run.error = `upload HTTP ${upload.status}: ${String(upload.body).slice(0, 200)}`;
    failures.add(1);
    console.log(`K6RUN ${JSON.stringify(run)}`);
    return;
  }
  run.predictionId = upload.json('predictionId');
  // Printed at once so an interrupted run still leaves its ids for cleanup.
  console.log(`K6UPLOAD ${JSON.stringify({ iteration: __ITER, predictionId: run.predictionId, uploadMs: run.uploadMs })}`);
  uploadMs.add(run.uploadMs);

  const deadline = t0 + MAX_WAIT_S * 1000;
  const pollAuth = { headers: auth.headers, timeout: '60s' };
  while (Date.now() < deadline && (run.predictionMs == null || run.explanationMs == null)) {
    if (run.predictionMs == null) {
      const prediction = findPrediction(pollAuth, run.predictionId);
      const counts = prediction && prediction.records;
      if (counts) {
        const finished =
          counts.byStatus.SUCCESS + counts.byStatus.ERROR + counts.byStatus.CANCELED;
        if (counts.total === EXPECTED_SAMPLES && finished === counts.total) {
          run.predictionMs = Date.now() - t0;
          run.modelVersion = prediction.modelVersion;
          run.recordSuccess = counts.byStatus.SUCCESS;
          run.recordError = counts.byStatus.ERROR + counts.byStatus.CANCELED;
        }
      }
    }

    if (run.explanationMs == null) {
      // 404 until the payload is stored, 422 when building it failed.
      const res = http.get(`${BASE_URL}/api/predict/${run.predictionId}/explain`, {
        headers: auth.headers,
        timeout: '120s',
        responseType: 'none',
      });
      if (res.status === 200) {
        // Ready when the server answered, not when the body finished arriving.
        run.explanationMs = Date.now() - t0 - res.timings.receiving;
        run.etag = res.headers['Etag'] || res.headers['ETag'] || null;
      } else if (res.status === 422) {
        run.error = 'explanation failed (HTTP 422)';
        break;
      }
    }
    sleep(POLL_MS / 1000);
  }

  if (run.predictionMs == null || run.explanationMs == null) {
    run.error = run.error || `timed out after ${MAX_WAIT_S}s`;
  } else {
    // The download on its own, after both are done, so polling does not overlap it.
    const res = http.get(`${BASE_URL}/api/predict/${run.predictionId}/explain`, {
      headers: auth.headers,
      timeout: '300s',
    });
    run.downloadStatus = res.status;
    run.downloadMs = res.timings.duration;
    // k6 decompresses gzip transparently, so this is the uncompressed size.
    run.uncompressedBytes = res.body ? res.body.length : 0;
    if (res.status === 200) {
      downloadMs.add(run.downloadMs);
      run.ok = run.recordError === 0;
      if (!run.ok) run.error = `${run.recordError} samples did not succeed`;
    } else {
      run.error = `download HTTP ${res.status}`;
    }
  }

  if (run.predictionMs != null) predictionMs.add(run.predictionMs);
  if (run.explanationMs != null) explanationMs.add(run.explanationMs);
  if (!run.ok) failures.add(1);
  console.log(`K6RUN ${JSON.stringify(run)}`);
}
