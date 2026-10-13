# Control plane (NestJS)

The API behind the XAIServe web UI. It handles sign-up and login with JWT, runs prediction jobs on a Bull queue backed by Redis, stores results in PostgreSQL through TypeORM, and keeps explanation payloads in Google Cloud Storage (or on local disk when `GCS_BUCKET` is unset). It also manages models through the inference service: listing MLflow runs, registering and publishing versions, and issuing the per-user MLflow access tokens shown on the Developer page.

All routes are under `/api`. Prediction progress is pushed to the browser as server-sent events under `/api/events/`.

| Directory | Contents |
|---|---|
| `src/auth`, `src/users` | Sign-up, login, JWT guard |
| `src/predictions`, `src/queue` | Prediction jobs, per-sample records, chunked SHAP requests |
| `src/events` | Server-sent events for job progress |
| `src/experiments`, `src/models`, `src/mlflow` | MLflow runs, model registration and publishing, access tokens |
| `src/storage` | GCS storage with signed download URLs, and the local-disk fallback |

## Running locally

```bash
docker compose up -d     # PostgreSQL on :5432, Redis on :6379, Adminer on :8081
cp .env.example .env     # point DATABASE_URL, REDIS_HOST and INFERENCE_SERVICE_URL at localhost
npm install
npm run start:dev        # http://localhost:3000/api
```

`.env.example` lists every setting. Tests run with `npm test`.
