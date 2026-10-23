// Latency of the Inference Service on its own, without the Control Plane.
//
// Each iteration sends
//   - every Sample to /v1/predict in one request           -> direct_predict_ms
//   - every Sample to /v1/explain/values in chunks of
//     CHUNK_SIZE, one after another, as the Control Plane
//     does (explain.builder.ts CHUNK_SIZE = 50)            -> direct_explain_ms
//
// Port 8080 is not exposed outside the VM, so INFERENCE_URL is normally an SSH
// tunnel: ssh -L 18080:127.0.0.1:8080 <user>@<app-vm-host>
//
// setup() also checks the CSV against the model: it explains one Sample and
// compares the feature names that come back with the CSV header.
//
// MODEL_VERSION is sent as ?version=, as the Control Plane does for a Prediction
// pinned to that version.
//
// Optional env: INFERENCE_URL, CSV_PATH, MODEL_NAME, MODEL_VERSION, CHUNK_SIZE,
//               ITERATIONS.

import http from 'k6/http';
import { fail } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const INFERENCE_URL = (__ENV.INFERENCE_URL || 'http://127.0.0.1:18080').replace(/\/$/, '');
const CSV_PATH = __ENV.CSV_PATH || '../../sample-data/yachidas_2019_test.csv';
const MODEL_NAME = __ENV.MODEL_NAME || 'crc-rynazal-notebook';
const MODEL_VERSION = __ENV.MODEL_VERSION || '1';
const CHUNK_SIZE = Number(__ENV.CHUNK_SIZE || 50);
const query = `?version=${encodeURIComponent(MODEL_VERSION)}`;
const ITERATIONS = Number(__ENV.ITERATIONS || 5);

// The CSV is plain numbers with an id column first; no quoted fields.
const lines = open(CSV_PATH).split(/\r?\n/).filter((line) => line.length > 0);
const columns = lines[0].split(',');
const rows = lines.slice(1).map((line) =>
  line.split(',').map((cell, i) => (i === 0 ? cell : Number(cell))),
);
const ids = rows.map((row) => String(row[0]));

const predictMs = new Trend('direct_predict_ms', true);
const explainMs = new Trend('direct_explain_ms', true);
const explainChunkMs = new Trend('direct_explain_chunk_ms', true);
const failures = new Counter('direct_failures');

export const options = {
  scenarios: {
    direct: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: '2h',
    },
  },
  setupTimeout: '600s',
};

const params = { headers: { 'Content-Type': 'application/json' }, timeout: '600s' };

function body(start, end) {
  return JSON.stringify({
    dataframe_split: {
      columns,
      data: rows.slice(start, end),
      index: ids.slice(start, end),
    },
  });
}

export function setup() {
  const res = http.post(`${INFERENCE_URL}/v1/explain/values/${MODEL_NAME}${query}`, body(0, 1), params);
  if (res.status !== 200) {
    fail(`schema check failed: HTTP ${res.status} ${String(res.body).slice(0, 300)}`);
  }
  const modelFeatures = res.json('feature_names');
  const csvFeatures = columns.slice(1);
  const missing = modelFeatures.filter((f) => !csvFeatures.includes(f));
  const extra = csvFeatures.filter((f) => !modelFeatures.includes(f));
  console.log(
    `K6SCHEMA ${JSON.stringify({
      samples: rows.length,
      csvFeatures: csvFeatures.length,
      modelFeatures: modelFeatures.length,
      missing: missing.length,
      extra: extra.length,
      modelVersion: res.json('model_version'),
    })}`,
  );
  if (missing.length || extra.length) {
    fail(`CSV does not match the model: ${missing.length} missing, ${extra.length} extra`);
  }
}

export default function () {
  const run = { iteration: __ITER, chunkSize: CHUNK_SIZE, chunksMs: [], ok: true };

  const predict = http.post(`${INFERENCE_URL}/v1/predict/${MODEL_NAME}${query}`, body(0, rows.length), params);
  run.predictStatus = predict.status;
  run.predictMs = predict.timings.duration;
  run.modelVersion = predict.status === 200 ? predict.json('model_version') : null;
  if (predict.status === 200 && (predict.json('predict') || []).length === rows.length) {
    predictMs.add(run.predictMs);
  } else {
    run.ok = false;
  }

  let total = 0;
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, rows.length);
    const res = http.post(`${INFERENCE_URL}/v1/explain/values/${MODEL_NAME}${query}`, body(start, end), params);
    run.chunksMs.push(res.timings.duration);
    total += res.timings.duration;
    if (res.status !== 200 || (res.json('values') || []).length !== end - start) {
      run.ok = false;
      run.explainError = `chunk ${start}-${end}: HTTP ${res.status}`;
      break;
    }
    explainChunkMs.add(res.timings.duration);
  }
  run.explainMs = total;
  if (!run.explainError) explainMs.add(total);

  if (!run.ok) failures.add(1);
  console.log(`K6RUN ${JSON.stringify(run)}`);
}
