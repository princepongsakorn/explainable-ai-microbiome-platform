# Use the official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.12.6-slim

ENV APP_HOME=/app
ENV PIP_NO_CACHE_DIR=1

WORKDIR $APP_HOME

RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install torch (CPU-only) from the official PyTorch CPU index first so the
# rest of the requirements.txt does not accidentally pull the CUDA wheel
# (~2 GB). Doing this as a separate layer also keeps the cache warm across
# changes to requirements.txt.
RUN python -m pip install --upgrade pip \
 && pip install --index-url https://download.pytorch.org/whl/cpu torch

# Install the remaining production dependencies.
COPY requirements.txt ./
RUN pip install -r ./requirements.txt

# Copy local code to container image
COPY kserve-shap-multi-modelserver.py ./

CMD ["python", "kserve-shap-multi-modelserver.py"]
