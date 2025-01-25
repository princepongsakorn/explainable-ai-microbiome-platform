FROM python:3.9-slim

RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install kserve mlflow joblib scikit-learn numpy shap

COPY mlflow-shap-runtime.py /app/mlflow-shap-runtime.py

WORKDIR /app

CMD ["python", "mlflow-shap-runtime.py"]