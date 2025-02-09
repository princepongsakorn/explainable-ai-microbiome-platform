# Use the official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.12.6-slim

ENV APP_HOME /app

WORKDIR $APP_HOME

RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
# Install production dependencies.
COPY requirements.txt ./
RUN python -m pip install --upgrade pip && pip install --no-cache-dir -r ./requirements.txt

# Copy local code to container image
COPY kserve-shap-multi-modelserver.py ./

CMD ["python", "kserve-shap-multi-modelserver.py"]