# Build from the repository root:
#   docker build -f services/blackbox/Dockerfile -t hallucination-blackbox .
# Run (credentials are supplied at runtime, never baked into the image):
#   docker run --rm -p 8000:8000 --env-file services/blackbox/.env \
#     -v hf-cache:/models hallucination-blackbox
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app

COPY services/blackbox/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY services/blackbox /app/services/blackbox

RUN useradd --create-home appuser \
    && mkdir -p /models \
    && chown -R appuser /models /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

CMD ["uvicorn", "services.blackbox.app:app", "--host", "0.0.0.0", "--port", "8000"]
