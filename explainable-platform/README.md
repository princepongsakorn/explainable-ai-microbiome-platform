# Web UI (Next.js)

The XAIServe frontend. Researchers upload samples and read their explanations here; data scientists review MLflow runs, publish models and get their MLflow access token. SHAP charts are drawn in the browser by [`shap-svg`](https://github.com/princepongsakorn/shap-svg), with the interface built on shadcn/ui and Tailwind.

| Page | Path |
|---|---|
| Upload samples and pick a model | `pages/upload/predict.tsx` |
| Prediction list, global charts, one sample's waterfall | `pages/prediction/` |
| MLflow runs and published models | `pages/experiments/` |
| Tracking URI and access token | `pages/developer/` |

The chart components and their wording are in `components/shap/`.

## Running locally

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API points at the API
npm install
npm run dev -- -p 3001       # http://localhost:3001
```

The API must be running; see [`../explainable-platform-service`](../explainable-platform-service).
