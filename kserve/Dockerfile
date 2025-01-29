# Use the official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.12.6-slim

ENV APP_HOME /app

ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=ap-southeast-1

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
COPY kserve-shap-modelserver.py ./

CMD ["python", "kserve-shap-modelserver.py"]